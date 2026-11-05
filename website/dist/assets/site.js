if (location.hostname === 'bigmints.github.io' && location.pathname.startsWith('/vox-studio')) {
  location.replace('https://fikr.one/vox' + location.pathname.slice('/vox-studio'.length) + location.search + location.hash);
}
const menu = document.querySelector('[data-menu]');
const links = document.getElementById('nav-links');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  links.classList.toggle('is-open', open);
});
links?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  links.classList.remove('is-open');
  menu?.setAttribute('aria-expanded', 'false');
  menu?.setAttribute('aria-label', 'Open navigation');
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    menu.click(); menu.focus();
  }
});
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.parentElement.querySelector('code').textContent);
      button.textContent = 'Copied';
    } catch { button.textContent = 'Select text to copy'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 2500);
  });
});
