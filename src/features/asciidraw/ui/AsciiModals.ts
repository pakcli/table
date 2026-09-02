import { App, Modal, Setting } from 'obsidian';

export class AsciiPromptModal extends Modal {
	private result: string | null = null;
	private submitted = false;

	constructor(
		app: App,
		private titleText: string,
		private defaultValue: string,
		private onSubmit: (result: string | null) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: this.titleText });

		let textValue = this.defaultValue;

		new Setting(contentEl)
			.addText((text) => {
				text.setValue(this.defaultValue);
				text.onChange((val) => {
					textValue = val;
				});
				text.inputEl.focus();
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.submitted = true;
						this.result = textValue;
						this.close();
					}
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('OK')
					.setCta()
					.onClick(() => {
						this.submitted = true;
						this.result = textValue;
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.onSubmit(this.submitted ? this.result : null);
	}
}

export class AsciiConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private titleText: string,
		private messageText: string,
		private onConfirm: (confirmed: boolean) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: this.titleText });
		contentEl.createEl('p', { text: this.messageText });

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Cancel')
					.onClick(() => {
						this.close();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Confirm')
					.setWarning()
					.onClick(() => {
						this.confirmed = true;
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.onConfirm(this.confirmed);
	}
}
