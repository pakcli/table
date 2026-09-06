import type { ICellRendererComp, ICellRendererParams } from "ag-grid-community";
import { ButtonComponent } from "obsidian";
import { GlobalTablesView } from "../GlobalTablesView";

export class ActionCellRenderer implements ICellRendererComp {
  private eGui!: HTMLDivElement;

  public init(params: ICellRendererParams<unknown, string, GlobalTablesView>): void {
    const { data, context } = params;

    this.eGui = createDiv();

    new ButtonComponent(this.eGui)
    .setIcon('trash-2')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .onClick(() => context.deleteElement(data as any))
  }

  public getGui(): HTMLElement {
    return this.eGui;
  }

  public refresh(_params: ICellRendererParams): boolean {
    return true;
  }
}