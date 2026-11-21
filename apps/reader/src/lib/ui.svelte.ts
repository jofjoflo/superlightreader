/** Global UI state shared between the root layout and pages. */
class Ui {
	/** "Lägg till serier"-sheet (AddSheet) open state; any page may set it, the root layout renders the sheet. */
	addOpen = $state(false);
	/** Captured `beforeinstallprompt` event (set by the root layout). null when not installable / already installed. */
	installEvent = $state<(Event & { prompt: () => Promise<void> }) | null>(null);
}
export const ui = new Ui();
