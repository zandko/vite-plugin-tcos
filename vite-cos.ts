import path, { resolve } from 'path';
import { unlink, readFileSync } from 'fs';
import chalk from 'chalk';
import { Buffer } from 'buffer';
import zlib from 'zlib';
import glob from 'glob';
import { mergeWith, cloneDeep, isPlainObject, merge, map } from 'lodash';
import type { Plugin, ResolvedBuildOptions } from 'vite';
import { normalizePath } from 'vite';
import COS from 'cos-nodejs-sdk-v5';

export interface TCouldCOSOptions {
  SecretId?: string;
  SecretKey?: string;
  Bucket?: string;
  Region?: string;
  options?: {
    headers?: any;
  };
}

export interface ViteCOSOptions {
  cosOptions?: TCouldCOSOptions;
  exclude?: RegExp;
  include?: RegExp;
  enableLog?: boolean;
  ignoreError?: boolean;
  removeMode?: boolean;
  cosBaseDir?: string;
  project: string;
  retry?: number;
  existCheck?: boolean;
  gzip?: boolean;
}

const defaultConfig: ViteCOSOptions = {
  retry: 3,
  existCheck: true,
  cosBaseDir: '',
  project: '',
  exclude: /.*\.html$/,
  include: /.*/,
  enableLog: false,
  ignoreError: false,
  removeMode: false,
  gzip: false,
};

const red = chalk.red;
const green = chalk.bold.green;
const yellow = chalk.yellow;

interface FileInfo {
  name: string;
  path: string;
  content: string | Buffer;
  $retryTime: number;
}

function getFileContentBuffer(
  file: FileInfo,
  gzipFlag: boolean | undefined
): Promise<Buffer> {
  if (!gzipFlag) return Promise.resolve(Buffer.from(file.content));
  return new Promise((resolve, reject) => {
    zlib.gzip(Buffer.from(file.content), {}, (err, gzipBuffer) => {
      if (err) reject(err);
      resolve(gzipBuffer);
    });
  });
}

export function log(...args: any[]) {
  console.log(chalk.bgMagenta('[cos-plugin]:'), ...args);
}

export function warn(...args: any[]) {
  console.warn(chalk.bgMagenta('[cos-plugin]:'), ...args);
}

export class HubCOS {
  config = defaultConfig;

  client: COS = {} as COS;

  finalPrefix: string = '';

  cosOptions: TCouldCOSOptions = {};

  constructor(config: ViteCOSOptions) {
    this.config = mergeWith(
      cloneDeep(this.config),
      config || {},
      (objVal, srcVal) => {
        if (isPlainObject(objVal) && isPlainObject(srcVal)) {
          return merge(objVal, srcVal);
        } else {
          return srcVal;
        }
      }
    );

    const { retry, cosOptions, cosBaseDir, project } = this.config;
    if (typeof retry !== 'number' || retry < 0) {
      this.config.retry = 0;
    }

    this.finalPrefix = `${cosBaseDir}/${project}`;

    this.debug('🔧 ' + green('Default configuration:'), defaultConfig);
    this.debug('🔧 ' + green('Project configuration:'), config);
    this.debug('🎯 ' + green('Final configuration:'), this.config);

    this.cosOptions = cosOptions as TCouldCOSOptions;


    this.client = new COS(cosOptions);
  }

  pickupAssetsFile(files: FileInfo[]): FileInfo[] | undefined {
    return files.filter((file) => {
      if (this.config.exclude?.test(file.name)) {
        return false;
      }
      return this.config.include?.test(file.name);
    });
  }

  async pluginEmitFn(
    sourceFiles: FileInfo[],
    compilation?: any,
    cb?: Function
  ) {
    this.client = new COS({
      SecretId: '',
      SecretKey: ''
    });

    const files = this.pickupAssetsFile(sourceFiles);
    if (!files) {
      warn(
        yellow(
          '\n🤔  No files found for upload, please check your configuration!'
        )
      );
      return;
    }
    log(green('\n🚀 COS upload starts......'));
    this.batchUploadFiles(files)
      .then(() => {
        log(green('🎉 COS upload completed\n'));

        if (this.config.removeMode) {
          files.forEach((file) => {
            if (compilation) {
              delete compilation.assets[file.name];
            } else {
              unlink(file.path, () => {});
            }
          });
        }
        cb && cb();
      })
      .catch((err) => {
        warn(
          red('❌ COS upload error') +
            '::: ' +
            red(err.code) +
            '-' +
            red(err.name) +
            ': ' +
            red(err.message)
        );
        if (!this.config.ignoreError) {
          if (compilation) {
            compilation.errors.push(err);
          } else {
            throw err;
          }
        }
        cb && cb();
      });
  }

  private checkCOSFile(
    file: FileInfo,
    idx: number,
    files: FileInfo[],
    uploadName: string
  ) {
    return new Promise((resolve, reject) => {
      this.client.headObject(
        {
          Bucket: this.cosOptions.Bucket!,
          Region: this.cosOptions.Region!,
          Key: uploadName,
        },
        (err, result) => {
          if (result) {
            log(
              green('✔ File already exists, no need for upload') +
                ` ${idx}/${files.length}: ` +
                green(uploadName)
            );
            resolve(result);
          } else {
            if (err && err.statusCode == 403) {
              warn(red('🔐 No read permission for this object'));
            }
            this.uploadFile(file, idx, files, uploadName)
              .then((uRes) => {
                resolve(uRes);
              })
              .catch((uErr) => {
                reject(uErr);
              });
          }
        }
      );
    });
  }

  private batchUploadFiles(files: FileInfo[]) {
    let i = 1;
    return Promise.all(
      map(files, (file) => {
        file.$retryTime = 0;
        let uploadName: string;
        if (path.sep === '/') {
          uploadName = path.join(this.finalPrefix, file.name);
        } else {
          uploadName = path
            .join(this.finalPrefix, file.name)
            .split(path.sep)
            .join('/');
        }
        if (!this.config.existCheck) {
          return this.uploadFile(file, i++, files, uploadName);
        } else {
          return this.checkCOSFile(file, i++, files, uploadName);
        }
      })
    );
  }

  private uploadFile(
    file: FileInfo,
    idx: number,
    files: FileInfo[],
    uploadName: string
  ) {
    return new Promise((resolve, reject) => {
      const fileCount = files.length;
      getFileContentBuffer(file, this.config.gzip)
        .then((contentBuffer) => {
          const _this = this;
          function _uploadAction() {
            file.$retryTime++;
            log(
              green('🚀 Start upload ') +
                ` ${idx}/${fileCount}: ` +
                (file.$retryTime > 1
                  ? 'Retry ' + (file.$retryTime - 1) + ' times'
                  : '') +
                green(uploadName)
            );
            _this.client.putObject(
              {
                Bucket: _this.cosOptions.Bucket!,
                Region: _this.cosOptions.Region!,
                Key: uploadName,
                Body: contentBuffer,
              },
              function (err, data) {
                if (err) {
                  if (file.$retryTime < _this.config.retry + 1) {
                    _uploadAction();
                  } else {
                    reject(err);
                  }
                } else {
                  log(
                    `🎉 Uploaded successfully ${idx}/${fileCount}: ${uploadName}`
                  );
                  resolve(data);
                }
              }
            );
          }
          _uploadAction();
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  private debug(...args: any[]) {
    this.config.enableLog && log(...args);
  }
}

export function ViteCOS(options: ViteCOSOptions): Plugin {
  let buildConfig: ResolvedBuildOptions;

  return {
    name: 'vite-cos-plugin',
    enforce: 'post',
    apply: 'build',
    configResolved(config) {
      buildConfig = config.build;
    },
    async closeBundle() {
      const client = new HubCOS(options);
      const outDirPath = normalizePath(
        resolve(normalizePath(buildConfig.outDir))
      );

      const files = glob.sync(`${outDirPath}/**/*`, {
        nodir: true,
        dot: true,
      }).map((file) => {
        const fileName = file.split(outDirPath)[1];

        return {
          name: fileName,
          path: file,
          content: readFileSync(file, { encoding: null }),
          $retryTime: 0,
        };
      });

      await client.pluginEmitFn(files);
    },
  };
}
