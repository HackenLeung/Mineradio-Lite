import { bus } from '../core/bus.js';

let currentRoute = 'home';
let previousRoute = 'home';
let leaveTimer = 0;
const TRANSITION_MS = 320;

export function navigate(route) {
  const target = document.querySelector(`[data-view="${route}"]`);
  if (!target) return;

  if (route === currentRoute) {
    // 同路由重复进入时，给一次轻量重入反馈
    target.classList.remove('page-enter');
    // force reflow
    void target.offsetWidth;
    target.classList.add('page-enter');
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => target.classList.remove('page-enter'), TRANSITION_MS);
    return;
  }

  if (route === 'detail' && currentRoute !== 'detail') previousRoute = currentRoute;
  const from = document.querySelector(`[data-view="${currentRoute}"]`);
  currentRoute = route;
  document.body.dataset.route = route;

  document.querySelectorAll('[data-route]').forEach((button) => {
    button.classList.toggle('active', button.dataset.route === route);
  });

  document.querySelectorAll('.page-view').forEach((view) => {
    view.classList.remove('page-enter', 'page-leave');
  });

  if (from && from !== target) {
    from.classList.add('active', 'page-leave');
    from.classList.remove('page-enter');
  }

  target.classList.add('active');
  target.classList.remove('page-leave');
  // force reflow so enter animation restarts
  void target.offsetWidth;
  target.classList.add('page-enter');

  window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    document.querySelectorAll('.page-view').forEach((view) => {
      if (view === target) {
        view.classList.remove('page-enter', 'page-leave');
        view.classList.add('active');
      } else {
        view.classList.remove('active', 'page-enter', 'page-leave');
      }
    });
  }, TRANSITION_MS);
}

export function mountShell() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.route));
  });
  bus.on('navigate', navigate);
  document.getElementById('detail-back')?.addEventListener('click', () => navigate(previousRoute));
  navigate('home');
}
