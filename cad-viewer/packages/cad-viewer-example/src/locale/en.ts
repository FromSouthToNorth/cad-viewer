export default {
  command: {
    ACAD: {
      quit: {
        description: 'Exits the application and closes all open drawings'
      },
      exit: {
        description: 'Exits the application and closes all open drawings'
      }
    }
  },
  fileUpload: {
    title: 'Select CAD File to View',
    subtitle: 'Import DWG or DXF drawings into the viewer',
    newDrawing: 'New Drawing',
    or: 'or',
    dropFile: 'Drop file or',
    browse: 'browse',
    openOptions: 'Open options',
    initialView: 'Initial view',
    accessMode: 'Access mode',
    textRendering: 'Text rendering',
    progressive: 'Progressive',
    nonPlottable: 'Non-plottable',
    viewModes: {
      auto: 'Auto',
      autoDesc: 'Based on access mode',
      extents: 'Extents',
      extentsDesc: 'Fit drawing',
      saved: 'Saved',
      savedDesc: 'AutoCAD saved view'
    },
    accessModes: {
      read: 'Read',
      readDesc: 'View only',
      review: 'Review',
      reviewDesc: 'View & review',
      write: 'Write',
      writeDesc: 'Full access'
    },
    textRenderingModes: {
      worker: 'Worker',
      workerDesc: 'Faster, more memory',
      mainThread: 'Main thread',
      mainThreadDesc: 'Slower, less memory'
    },
    progressiveModes: {
      on: 'On',
      onDesc: 'Show geometry while loading',
      off: 'Off',
      offDesc: 'Wait until fully converted'
    },
    nonPlottableModes: {
      hide: 'Hide',
      hideDesc: 'Web viewer default',
      show: 'Show',
      showDesc: 'AutoCAD editor semantics'
    }
  }
}
