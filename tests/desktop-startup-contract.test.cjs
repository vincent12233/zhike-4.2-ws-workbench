'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const xaml = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'MainWindow.xaml'), 'utf8');

// NavigationViewItem.Icon is converted by WinUI XAML at runtime.  The XAML
// compiler does not reject unknown Symbol names, so a typo can make the
// entire desktop process terminate in Microsoft.UI.Xaml before a window is
// shown. Keep this contract deliberately explicit and close to the Windows
// SDK Symbol enum used by the project.
const supportedSymbols = new Set([
  'Home', 'Add', 'Calendar', 'ViewAll', 'Contact', 'List', 'Message', 'People',
  'Favorite', 'ContactInfo', 'Important', 'Sync', 'Delete', 'Setting', 'Phone',
  'Sort', 'Target', 'FourBars', 'ProtectedDocument', 'Library', 'Clock', 'Calculator',
]);

const icons = [...xaml.matchAll(/Icon="([^"]+)"/g)].map((match) => match[1]);
const invalid = icons.filter((icon) => !supportedSymbols.has(icon));
assert.deepEqual(invalid, [], `MainWindow.xaml contains unsupported WinUI Symbol icons: ${invalid.join(', ')}`);

console.log('desktop startup contract: all MainWindow navigation icons resolve to WinUI Symbol values');
