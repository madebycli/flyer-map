// Shared UI gestures of the field shell: the Home menu and the marking button with its morphing panels.
export const openMenu = (page) => page.getByRole('button', { name: 'Menü' }).click();
/** Open the Home menu and press one of its tiles. */
export const menuTile = async (page, name) => { await openMenu(page); await page.getByRole('button', { name, exact: true }).click(); };
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
