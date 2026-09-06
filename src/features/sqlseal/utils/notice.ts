import { Notice } from "obsidian"

export const errorNotice = (text: string) => {
    const n = new Notice(text)
    const el = n.noticeEl ?? ((n as any).messageEl as HTMLElement | undefined);
    el?.classList.add('sqlseal-notice-error');
    return n;
}