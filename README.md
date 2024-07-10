# vite-plugin-tcos

`ViteCOS` 是一个用于 Vite 的腾讯云 COS 静态资源上传插件，可以将构建后的静态资源上传到腾讯云 COS。

## 安装

```bash
npm install vite-plugin-tcos --save-dev
```

## 使用

在 `vite.config.js` 或 `vite.config.ts` 中引入并使用插件：

```js
import { ViteCOS } from 'vite-plugin-tcos';

export default {
  plugins: [
    ViteCOS({
      cosOptions: {
        SecretId: 'your-secret-id',
        SecretKey: 'your-secret-key',
        Bucket: 'your-bucket',
        Region: 'your-region',
      },
      cosBaseDir: 'your-base-dir',
      project: 'your-project',
    }),
  ],
};
```

## 配置

`ViteCOS` 接受一个配置对象，以下是所有可用的配置项：

| 属性        | 类型    | 默认值           | 描述                           |
| ----------- | ------- | ---------------- | ------------------------------ |
| provider    | object  | {}               | 腾讯云 COS 的 Bucket 和 Region |
| exclude     | RegExp  | /.\*\.html$/     | 需要排除的文件                 |
| include     | RegExp  | /.\*/            | 需要包含的文件                 |
| enableLog   | boolean | false            | 是否启用日志                   |
| ignoreError | boolean | false            | 是否忽略错误                   |
| cosBaseDir  | string  | 'auto_upload_ci' | COS 的基础目录                 |
| project     | string  | ''               | 项目名称                       |
| retry       | number  | 3                | 上传失败时的重试次数           |
| existCheck  | boolean | true             | 是否检查文件是否已存在         |
| removeMode  | boolean | false             | 是否删除已上传文件         |

## 示例

```js
import { ViteCOS } from 'vite-plugin-tcos';

export default {
  plugins: [
    ViteCOS({
      cosOptions: {
        SecretId: 'my-secret-id',
        SecretKey: 'my-secret-key',
        Bucket: 'my-bucket',
        Region: 'ap-guangzhou',
      },
      cosBaseDir: 'my-app',
      project: 'v1',
      exclude: /.*\.map$/,
      include: /.*\.js$/,
      enableLog: true,
      ignoreError: false,
      retry: 5,
      existCheck: false,
    }),
  ],
};
```

在这个示例中，插件将会把所有 `.js` 文件上传到 `my-bucket` 的 `my-app/v1` 目录下，忽略所有 `.map` 文件。如果上传失败，将会重试 5 次。如果文件已存在，将不会上传。同时，插件将会打印日志。
