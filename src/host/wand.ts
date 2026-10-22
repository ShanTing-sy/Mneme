export function ensureWandButton(onClick: () => void, tries = 120): void {
  if (typeof document === 'undefined') return;
  const menu = document.getElementById('extensionsMenu');
  if (!menu) {
    if (tries > 0) setTimeout(() => ensureWandButton(onClick, tries - 1), 500);
    return;
  }
  if (document.getElementById('mneme-wand')) return;

  const container = document.createElement('div');
  container.className = 'extension_container';
  container.id = 'mneme-wand';

  const button = document.createElement('div');
  button.className = 'list-group-item flex-container flexGap5';
  button.setAttribute('role', 'button');
  button.tabIndex = 0;

  const icon = document.createElement('div');
  icon.className = 'fa-solid fa-brain extensionsMenuExtensionButton';

  const label = document.createElement('span');
  label.textContent = 'Mneme';

  const dot = document.createElement('span');
  dot.id = 'mneme-wand-dot';
  dot.className = 'mneme-badge-dot';
  dot.style.display = 'none';

  button.append(icon, label, dot);
  button.addEventListener('click', onClick);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') onClick();
  });

  container.appendChild(button);
  menu.appendChild(container);
}

export function setWandDot(on: boolean): void {
  if (typeof document === 'undefined') return;
  const dot = document.getElementById('mneme-wand-dot');
  if (dot) dot.style.display = on ? 'inline-block' : 'none';
}
