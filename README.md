# Plug-in

个人娱乐插件集合。这个仓库用于管理多个浏览器插件，每个插件放在 `plugins/<plugin-name>/` 下，插件之间保持独立的 manifest、源码、资源和测试。

## 插件列表

- [网页梗化器](plugins/web-memefier/README.md)：一键给网页图片叠加梗化贴纸，并把页面文字抽象化。

## 目录约定

```text
plugins/
  web-memefier/
    manifest.json
    popup.html
    src/
    assets/
    icons/
    test/
```

后续新增插件时，直接在 `plugins/` 下新建独立目录，避免不同插件的依赖、资源和配置互相影响。
