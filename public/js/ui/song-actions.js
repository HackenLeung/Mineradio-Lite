import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { addSongToPlaylist, coverUrl, fetchLikeStatus, fetchSongComments, fetchUserPlaylists, setSongLiked } from '../core/api.js';
import { toast } from './toast.js';

function clear(node) { while (node?.firstChild) node.removeChild(node.firstChild); }
function currentNeteaseSong() {
  const song = store.get().now;
  return song && (song.provider || song.source || 'netease') === 'netease' ? song : null;
}
function close(id) { const modal = document.getElementById(id); if (modal) modal.hidden = true; }
function formatCommentCount(n) {
  const value = Math.max(0, Math.floor(Number(n) || 0));
  return value > 999 ? '999+' : String(value);
}
function setCommentCountDisplay(n) {
  const el = document.getElementById('comment-count');
  if (el) el.textContent = formatCommentCount(n);
}

export function mountSongActions() {
  const likeButton = document.getElementById('btn-like');
  const commentButton = document.getElementById('btn-comments');
  const collectButton = document.getElementById('btn-collect');
  let liked = false;
  let likeToken = 0;
  let commentToken = 0;

  async function syncLike(song) {
    const token = ++likeToken;
    liked = false;
    likeButton?.classList.remove('liked');
    if (!song || (song.provider || song.source || 'netease') !== 'netease') return;
    try {
      const data = await fetchLikeStatus(song.id);
      if (token !== likeToken) return;
      liked = !!data?.liked?.[String(song.id)];
      likeButton?.classList.toggle('liked', liked);
      if (likeButton) likeButton.title = liked ? '取消红心' : '红心喜欢';
    } catch (_) {}
  }

  likeButton?.addEventListener('click', async () => {
    const song = currentNeteaseSong();
    if (!song) { toast('红心功能当前支持网易云歌曲'); return; }
    likeButton.disabled = true;
    try {
      const data = await setSongLiked(song.id, !liked);
      liked = !!data.liked;
      likeButton.classList.toggle('liked', liked);
      likeButton.title = liked ? '取消红心' : '红心喜欢';
      toast(liked ? '已加入红心' : '已取消红心');
    } catch (error) { toast.error(error.message || '红心操作失败，请先登录网易云'); }
    finally { likeButton.disabled = false; }
  });

  async function syncCommentCount(song) {
    const token = ++commentToken;
    if (!song || (song.provider || song.source || 'netease') !== 'netease') {
      setCommentCountDisplay(0);
      return;
    }
    try {
      // 仅取总数：limit=1 降低流量，total 由后端 body.total 提供
      const data = await fetchSongComments(song.id, 1, 0);
      if (token !== commentToken) return;
      setCommentCountDisplay(data.total || data.comments?.length || 0);
    } catch (_) {
      if (token !== commentToken) return;
      setCommentCountDisplay(0);
    }
  }

  commentButton?.addEventListener('click', async () => {
    const song = currentNeteaseSong();
    if (!song) { toast('评论当前支持网易云歌曲'); return; }
    const modal = document.getElementById('comment-modal');
    const list = document.getElementById('comment-list');
    document.getElementById('comment-title').textContent = '评论';
    document.getElementById('comment-sub').textContent = `${song.name || '当前歌曲'} · ${song.artist || ''}`;
    clear(list); const loading = document.createElement('div'); loading.className = 'loading'; loading.textContent = '正在读取评论…'; list.appendChild(loading); modal.hidden = false;
    try {
      const data = await fetchSongComments(song.id, 30, 0);
      clear(list);
      setCommentCountDisplay(data.total || data.comments?.length || 0);
      const comments = Array.isArray(data.comments) ? data.comments : [];
      if (!comments.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无评论'; list.appendChild(empty); return; }
      comments.forEach((comment) => {
        const row = document.createElement('article'); row.className = 'comment-item';
        const avatar = document.createElement('img'); avatar.alt = ''; avatar.loading = 'lazy'; if (comment.user?.avatar) avatar.src = coverUrl(comment.user.avatar, 80);
        const copy = document.createElement('div'); const author = document.createElement('div'); author.className = 'comment-author'; author.textContent = comment.user?.nickname || '网易云用户';
        const content = document.createElement('div'); content.className = 'comment-content'; content.textContent = comment.content || '';
        const meta = document.createElement('div'); meta.className = 'comment-meta'; meta.textContent = `${comment.time ? new Date(comment.time).toLocaleString() : ''}${comment.likedCount ? ` · ${comment.likedCount} 赞` : ''}`;
        copy.append(author, content, meta); row.append(avatar, copy); list.appendChild(row);
      });
    } catch (error) { clear(list); const line = document.createElement('div'); line.className = 'error-line'; line.textContent = error.message || '评论读取失败'; list.appendChild(line); }
  });

  collectButton?.addEventListener('click', async () => {
    const song = currentNeteaseSong();
    if (!song) { toast('收藏到歌单当前支持网易云歌曲'); return; }
    const modal = document.getElementById('collect-modal'); const list = document.getElementById('collect-list'); const status = document.getElementById('collect-status');
    modal.hidden = false; clear(list); status.hidden = false; status.textContent = '正在读取歌单…';
    try {
      const data = await fetchUserPlaylists('netease'); const playlists = (data.playlists || []).filter((item) => !item.subscribed);
      status.hidden = playlists.length > 0; status.textContent = playlists.length ? '选择要加入的歌单' : '没有可写入的自建歌单';
      playlists.forEach((item) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'collect-item';
        const img = document.createElement('img'); img.alt = ''; if (item.cover) img.src = coverUrl(item.cover, 90);
        const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.name || '未命名歌单'; const meta = document.createElement('span'); meta.textContent = `${item.trackCount || 0} 首`; copy.append(title, meta); button.append(img, copy);
        button.addEventListener('click', async () => { button.disabled = true; try { await addSongToPlaylist(item.id, song.id); close('collect-modal'); toast(`已加入「${item.name || '歌单'}」`); } catch (error) { toast.error(error.message || '加入歌单失败'); } finally { button.disabled = false; } });
        list.appendChild(button);
      });
    } catch (error) { status.textContent = error.message || '歌单读取失败，请先登录网易云'; }
  });

  document.getElementById('comment-close')?.addEventListener('click', () => close('comment-modal'));
  document.getElementById('collect-close')?.addEventListener('click', () => close('collect-modal'));
  document.getElementById('comment-modal')?.addEventListener('click', (event) => { if (event.target.id === 'comment-modal') close('comment-modal'); });
  document.getElementById('collect-modal')?.addEventListener('click', (event) => { if (event.target.id === 'collect-modal') close('collect-modal'); });
  const initial = store.get().now;
  if (initial) {
    syncLike(initial);
    syncCommentCount(initial);
  } else {
    setCommentCountDisplay(0);
  }
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { close('comment-modal'); close('collect-modal'); } });
  bus.on('song-change', (song) => {
    syncLike(song);
    syncCommentCount(song);
  });
}
