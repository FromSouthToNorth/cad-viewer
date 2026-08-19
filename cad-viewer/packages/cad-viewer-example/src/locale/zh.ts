export default {
  command: {
    ACAD: {
      quit: {
        description: '退出应用程序并关闭所有打开的图纸'
      },
      exit: {
        description: '退出应用程序并关闭所有打开的图纸'
      }
    }
  },
  fileUpload: {
    title: '选择要查看的 CAD 文件',
    subtitle: '将 DWG 或 DXF 图纸导入查看器',
    newDrawing: '新建图纸',
    or: '或',
    dropFile: '拖拽文件到此处，或',
    browse: '点击选择',
    openOptions: '打开选项',
    initialView: '初始视图',
    accessMode: '访问模式',
    textRendering: '文字渲染',
    progressive: '渐进渲染',
    nonPlottable: '不可打印图层',
    viewModes: {
      auto: '自动',
      autoDesc: '根据访问模式决定',
      extents: '范围',
      extentsDesc: '缩放至图纸范围',
      saved: '已保存视图',
      savedDesc: 'AutoCAD 保存的视图'
    },
    accessModes: {
      read: '只读',
      readDesc: '仅查看',
      review: '审阅',
      reviewDesc: '查看与审阅',
      write: '编辑',
      writeDesc: '完全访问'
    },
    textRenderingModes: {
      worker: 'Worker 线程',
      workerDesc: '更快，占用更多内存',
      mainThread: '主线程',
      mainThreadDesc: '较慢，占用更少内存'
    },
    progressiveModes: {
      on: '开',
      onDesc: '加载过程中显示图形',
      off: '关',
      offDesc: '等待完全转换后显示'
    },
    nonPlottableModes: {
      hide: '隐藏',
      hideDesc: 'Web 查看器默认行为',
      show: '显示',
      showDesc: 'AutoCAD 编辑器行为'
    }
  }
}
