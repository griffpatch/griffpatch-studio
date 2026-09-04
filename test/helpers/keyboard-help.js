import {By} from 'selenium-webdriver';

// Existing editing tests explicitly acknowledge onboarding, just as a user
// would. The guide's dedicated tests use a fresh profile without this helper.
export const dismissKeyboardHelp = async driver => {
    await driver.wait(() => driver.executeScript(`return !!document.querySelector('dialog[open][aria-label="Keyboard editing guide"]') ||
        document.activeElement?.getAttribute('aria-label') === 'Scratch keyboard editor';`), 20000);
    const buttons = await driver.findElements(By.css('dialog[open][aria-label="Keyboard editing guide"] footer button'));
    if (buttons.length) await buttons[0].click();
};
