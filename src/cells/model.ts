// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  nbformat, utils
} from '@jupyterlab/services';

import {
  JSONValue
} from 'phosphor/lib/algorithm/json';

import {
  defineSignal, ISignal
} from 'phosphor/lib/core/signaling';

import {
  CodeEditor
} from '../codeeditor';

import {
  IChangedArgs
} from '../common/interfaces';

import {
  IObservableMap, ObservableMap
} from '../common/observablemap';

import {
  IOutputAreaModel, OutputAreaModel
} from '../outputarea';


/**
 * The definition of a model object for a cell.
 */
export
interface ICellModel extends CodeEditor.IModel {
  /**
   * The type of the cell.
   */
  readonly type: nbformat.CellType;

  /**
   * A signal emitted when the content of the model changes.
   */
  readonly contentChanged: ISignal<ICellModel, void>;

  /**
   * A signal emitted when a model state changes.
   */
  readonly stateChanged: ISignal<ICellModel, IChangedArgs<any>>;

  /**
   * Whether the cell is trusted.
   */
  trusted: boolean;

  /**
   * The metadata associated with the cell.
   */
  readonly metadata: IObservableMap<JSONValue>;

  /**
   * Serialize the model to JSON.
   */
  toJSON(): nbformat.ICell;
}


/**
 * The definition of a code cell.
 */
export
interface ICodeCellModel extends ICellModel {
  /**
   * The type of the cell.
   *
   * #### Notes
   * This is a read-only property.
   */
  type: 'code';

  /**
   * The code cell's prompt number. Will be null if the cell has not been run.
   */
  executionCount: nbformat.ExecutionCount;

  /**
   * The cell outputs.
   */
  outputs: IOutputAreaModel;
}


/**
 * The definition of a markdown cell.
 */
export
interface IMarkdownCellModel extends ICellModel {
  /**
   * The type of the cell.
   */
  type: 'markdown';
 }


/**
 * The definition of a raw cell.
 */
export
interface IRawCellModel extends ICellModel {
  /**
   * The type of the cell.
   */
  type: 'raw';
}


/**
 * An implementation of the cell model.
 */
export
class CellModel extends CodeEditor.Model implements ICellModel {
  /**
   * Construct a cell model from optional cell content.
   */
  constructor(options: CellModel.IOptions) {
    super();
    this.value.changed.connect(this.onGenericChange, this);
    let cell = options.cell;
    if (!cell) {
      return;
    }
    if (Array.isArray(cell.source)) {
      this.value.text = (cell.source as string[]).join('\n');
    } else {
      this.value.text = cell.source as string;
    }
    let metadata = utils.copy(cell.metadata);
    if (this.type !== 'raw') {
      delete metadata['format'];
    }
    if (this.type !== 'code') {
      delete metadata['collapsed'];
      delete metadata['scrolled'];
    }
    for (let key in metadata) {
      this._metadata.set(key, metadata[key]);
    }
    this._metadata.changed.connect(this.onGenericChange, this);
  }

  /**
   * The type of cell.
   */
  readonly type: nbformat.CellType;

  /**
   * A signal emitted when the state of the model changes.
   */
  readonly contentChanged: ISignal<this, void>;

  /**
   * A signal emitted when a model state changes.
   */
  readonly stateChanged: ISignal<this, IChangedArgs<any>>;

  /**
   * The metadata associated with the cell.
   */
  get metadata(): IObservableMap<JSONValue> {
    return this._metadata;
  }

  /**
   * Get the trusted state of the model.
   */
  get trusted(): boolean {
    return !!this.metadata.get('trusted');
  }

  /**
   * Set the trusted state of the model.
   */
  set trusted(newValue: boolean) {
    let oldValue = this.metadata.get('trusted');
    if (oldValue === newValue) {
      return;
    }
    this.metadata.set('trusted', newValue);
    this.stateChanged.emit({ name: 'trusted', oldValue, newValue });
  }

  /**
   * Dispose of the resources held by the model.
   */
  dispose(): void {
    this._metadata.dispose();
    super.dispose();
  }

  /**
   * Serialize the model to JSON.
   */
  toJSON(): nbformat.ICell {
    let metadata: nbformat.IBaseCellMetadata = Object.create(null);
    for (let key in this.metadata.keys()) {
      let value = JSON.parse(JSON.stringify(this.metadata.get(key)));
      metadata[key] = value as JSONValue;
    }
    return {
      cell_type: this.type,
      source: this.value.text,
      metadata,
    } as nbformat.ICell;
  }

  /**
   * Handle a change to the observable value.
   */
  protected onGenericChange(): void {
    this.contentChanged.emit(void 0);
  }

  private _metadata = new ObservableMap<JSONValue>();
}


/**
 * The namespace for `CellModel` statics.
 */
export
namespace CellModel {
  /**
   * The options used to initialize a `CellModel`.
   */
  export interface IOptions {
    /**
     * The source cell data.
     */
    cell?: nbformat.IBaseCell;
  }
}


// Define the signals for the `CellModel` class.
defineSignal(CellModel.prototype, 'contentChanged');
defineSignal(CellModel.prototype, 'stateChanged');


/**
 * An implementation of a raw cell model.
 */
export
class RawCellModel extends CellModel {
  /**
   * The type of the cell.
   */
  get type(): 'raw' {
    return 'raw';
  }
}


/**
 * An implementation of a markdown cell model.
 */
export
class MarkdownCellModel extends CellModel {
  /**
   * Construct a markdown cell model from optional cell content.
   */
  constructor(options: CellModel.IOptions) {
    super(options);
    // Use the Github-flavored markdown mode.
    this.mimeType = 'text/x-ipythongfm';
  }

  /**
   * The type of the cell.
   */
  get type(): 'markdown' {
    return 'markdown';
  }
}


/**
 * An implementation of a code cell Model.
 */
export
class CodeCellModel extends CellModel implements ICodeCellModel {
  /**
   * Construct a new code cell with optional original cell content.
   */
  constructor(options: CodeCellModel.IOptions) {
    super(options);
    let factory = (options.contentFactory ||
      CodeCellModel.defaultContentFactory
    );
    let trusted = this.trusted;
    this._outputs = factory.createOutputArea({ trusted });
    let cell = options.cell as nbformat.ICodeCell;
    if (cell && cell.cell_type === 'code') {
      this.executionCount = cell.execution_count;
      for (let output of cell.outputs) {
        this._outputs.add(output);
      }
    }
    this._outputs.changed.connect(this.onGenericChange, this);
    this._outputs.itemChanged.connect(this.onGenericChange, this);
    this.metadata.changed.connect(this._onMetadataChanged, this);
  }

  /**
   * The type of the cell.
   */
  get type(): 'code' {
    return 'code';
  }

  /**
   * The execution count of the cell.
   */
  get executionCount(): nbformat.ExecutionCount {
    return this._executionCount || null;
  }
  set executionCount(newValue: nbformat.ExecutionCount) {
    if (newValue === this._executionCount) {
      return;
    }
    let oldValue = this.executionCount;
    this._executionCount = newValue || null;
    this.contentChanged.emit(void 0);
    this.stateChanged.emit({ name: 'executionCount', oldValue, newValue });
  }

  /**
   * The cell outputs.
   */
  get outputs(): IOutputAreaModel {
    return this._outputs;
  }

  /**
   * Dispose of the resources held by the model.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._outputs.dispose();
    this._outputs = null;
    super.dispose();
  }

  /**
   * Serialize the model to JSON.
   */
  toJSON(): nbformat.ICodeCell {
    let cell = super.toJSON() as nbformat.ICodeCell;
    cell.execution_count = this.executionCount || null;
    cell.outputs = this.outputs.toJSON();
    return cell;
  }

  /**
   * Handle the metadata changing.
   */
  private _onMetadataChanged(sender: ObservableMap<JSONValue>, args: ObservableMap.IChangedArgs<JSONValue>): void {
    this._outputs.trusted = !!args.newValue;
  }

  private _outputs: IOutputAreaModel = null;
  private _executionCount: nbformat.ExecutionCount = null;
}


/**
 * The namespace for `CodeCellModel` statics.
 */
export
namespace CodeCellModel {
  /**
   * The options used to initialize a `CodeCellModel`.
   */
  export interface IOptions {
    /**
     * The source cell data.
     */
    cell?: nbformat.IBaseCell;

    /**
     * The factory for output area model creation.
     */
    contentFactory?: IContentFactory;
  }

  /**
   * A factory for creating code cell model content.
   */
  export
  interface IContentFactory {
    /**
     * Create an output area.
     */
    createOutputArea(options: OutputAreaModel.IOptions): IOutputAreaModel;
  }

  /**
   * The default implementation of an `IContentFactory`.
   */
  export
  class ContentFactory {
    /**
     * Create an output area.
     */
    createOutputArea(options: OutputAreaModel.IOptions): IOutputAreaModel {
      return new OutputAreaModel(options);
    }
  }

  /**
   * The shared `ConetntFactory` instance.
   */
  export
  const defaultContentFactory = new ContentFactory();
}
