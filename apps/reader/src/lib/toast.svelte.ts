export interface Toast {
	id: number;
	message: string;
	kind: 'info' | 'ok' | 'error';
	action?: { label: string; run: () => void };
}

class Toasts {
	items = $state<Toast[]>([]);
	private n = 0;

	show(message: string, opts: { kind?: Toast['kind']; action?: Toast['action']; ms?: number } = {}) {
		const t: Toast = { id: ++this.n, message, kind: opts.kind ?? 'info', action: opts.action };
		this.items = [...this.items, t];
		setTimeout(() => this.dismiss(t.id), opts.ms ?? 4200);
	}
	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

/** import { toast } from '$lib/toast.svelte'; toast.show('Klart', { kind: 'ok' }) */
export const toast = new Toasts();
