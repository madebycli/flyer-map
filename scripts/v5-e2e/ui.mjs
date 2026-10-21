// Shared UI gestures of the field shell: the Home menu and the marking button with its morphing panels.
export const openMenu = async (page) => {
  // The Gebiete / Sonder-Marker tools replace the menu with their own bar; "Fertig" leaves the tool.
  const menu = page.getByRole('button', { name: 'Menü', exact: true });
  if (!(await menu.count()) && (await page.getByRole('button', { name: 'Fertig', exact: true }).count())) await page.getByRole('button', { name: 'Fertig', exact: true }).click();
  await menu.click();
};
/** Things that live one level below the menu: the settings page and the templates page. */
const BELOW = { Farbe: 'Einstellungen', Diagnose: 'Einstellungen', 'Alt-Import': 'Einstellungen', 'Vorlage laden': 'Vorlagen', 'Als Vorlage speichern': 'Vorlagen' };
/** Open the menu and press one of its rows (going through the page it lives on, if it is below the menu). */
export const menuTile = async (page, name) => {
  await openMenu(page);
  if (BELOW[name]) await page.getByRole('button', { name: BELOW[name], exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
};
/** The settings page: appearance, hand, basemap. */
export const openSettings = async (page) => { await openMenu(page); await page.getByRole('button', { name: 'Einstellungen', exact: true }).click(); };
/** Appearance in the settings: 'Hell' or 'Dunkel' (a segmented choice). */
export const setAppearance = async (page, name) => { await openSettings(page); await page.getByRole('button', { name, exact: true }).click(); };
/** Type into the search bar at the top of the map. */
export const searchFor = async (page, text) => { const input = page.getByRole('textbox', { name: 'Straße oder Adresse suchen' }); await input.click(); await input.fill(text); };
/** A plain tap on the marking button starts marking in route mode. */
export const startMarking = (page) => page.getByRole('button', { name: 'Markieren starten' }).click();
/** Long press (the way to the options panel without the counter tile). */
export const longPress = async (page, locator, ms = 650) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
};
/** Panel → options (via the first tile), pick a mode, back to the panel. */
export const setMode = async (page, mode) => {
  await page.locator('.v5-fab .v5-tile').first().click();
  await page.locator('.v5-fab').getByRole('button', { name: mode, exact: true }).click();
  await page.getByRole('button', { name: 'Weiter markieren' }).click();
};
/** Options panel: set the brush status (only offered outside route mode). */
export const setBrush = async (page, label) => {
  await page.locator('.v5-fab .v5-tile').first().click();
  await page.locator('.v5-fab').getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'Weiter markieren' }).click();
};
/** Route mode: confirm the route and choose what it becomes. */
export const confirmRoute = async (page, label = 'Ausgeteilt') => {
  await page.getByRole('button', { name: 'Strecke bestätigen' }).click();
  await page.locator('.v5-fab').getByRole('button', { name: label, exact: true }).click();
};
