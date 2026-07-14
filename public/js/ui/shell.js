import { bus } from '../core/bus.js';

let currentRoute = 'home';
let previousRoute = 'home';

export function navigate(route) {
  const target = document.querySelector(`[data-view="${route}"]`);
  if (!target) return;
  if (route === 'detail' && currentRoute !== 'detail') previousRoute = currentRoute;
  currentRoute = route;
  document.body.dataset.route = route;
  document.querySelectorAll('.page-view').forEach((view) => view.classList.toggle('active', view === target));
  document.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('active', button.dataset.route === route));
}

export function mountShell() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.route));
  });
  bus.on('navigate', navigate);
  document.getElementById('detail-back')?.addEventListener('click', () => navigate(previousRoute));
  navigate('home');
}
