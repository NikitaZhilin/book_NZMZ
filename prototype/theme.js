/* Тема: применяется до отрисовки, переключатель подключается сам (CSP: без inline-скриптов). */
(function () {
  var key = 'misha-theme';
  var root = document.documentElement;
  var stored = 'auto';
  try { stored = localStorage.getItem(key) || 'auto'; } catch (error) {}
  if (['light', 'dark', 'auto'].indexOf(stored) === -1) stored = 'auto';
  root.setAttribute('data-theme', stored);

  var titles = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };

  function apply(value) {
    stored = ['light', 'dark', 'auto'].indexOf(value) === -1 ? 'auto' : value;
    root.setAttribute('data-theme', stored);
    try { localStorage.setItem(key, stored); } catch (error) {}
    document.dispatchEvent(new CustomEvent('misha:theme', { detail: stored }));
  }

  window.mishaTheme = {
    get: function () { return stored; },
    set: apply,
    next: function () {
      return stored === 'auto' ? 'light' : stored === 'light' ? 'dark' : 'auto';
    }
  };

  function sync(button) {
    button.setAttribute('aria-label', titles[stored] + ' — переключить');
    button.title = titles[stored];
  }

  function connect() {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    sync(button);
    button.addEventListener('click', function () {
      apply(window.mishaTheme.next());
      sync(button);
    });
    document.addEventListener('misha:theme', function () { sync(button); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect);
  else connect();
})();
