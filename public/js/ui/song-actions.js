import { store } from '../core/store.js';
import { bus } from '../core/bus.js';
import { addSongToPlaylist, coverUrl, fetchLikeStatus, fetchSongComments, fetchUserPlaylists, setSongLiked } from '../core/api.js';
import { toast } from './toast.js';
import { openLocalMatchModal } from './local-match.js';

function clear(node) { while (node?.firstChild) node.removeChild(node.firstChild); }

/** 评论/红心目标：网易云曲，或本地曲匹配到的网易云 onlineMetadata。 */
function commentTargetSong(song) {
  if (!song) return null;
  const provider = song.provider || song.source || song.type || 'netease';
  if (provider === 'netease' && song.id && /^\d+$/.test(String(song.id))) {
    return { provider: 'netease', id: String(song.id), name: song.name || '', artist: song.artist || '' };
  }
  if (provider === 'local' || song.type === 'local') {
    const meta = song.onlineMetadata;
    if (meta && (meta.provider === 'netease' || !meta.provider) && meta.id && /^\d+$/.test(String(meta.id))) {
      return {
        provider: 'netease',
        id: String(meta.id),
        name: meta.name || song.name || '',
        artist: meta.artist || song.artist || '',
      };
    }
  }
  return null;
}

function isLocalSong(song) {
  return !!(song && ((song.provider || song.source || song.type) === 'local' || song.type === 'local'));
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
    const target = commentTargetSong(song);
    if (!target) return;
    try {
      const data = await fetchLikeStatus(target.id);
      if (token !== likeToken) return;
      liked = !!data?.liked?.[String(target.id)];
      likeButton?.classList.toggle('liked', liked);
      if (likeButton) likeButton.title = liked ? '取消红心' : '红心喜欢';
    } catch (_) {}
  }

  likeButton?.addEventListener('click', async () => {
    const song = store.get().now;
    const target = commentTargetSong(song);
    if (!target) {
      if (isLocalSong(song)) {
        toast('本地歌曲请先匹配网易云曲目后再红心');
        openLocalMatchModal(song);
      } else {
        toast('红心功能当前支持网易云歌曲');
      }
      return;
    }
    likeButton.disabled = true;
    try {
      const data = await setSongLiked(target.id, !liked);
      liked = !!data.liked;
      likeButton.classList.toggle('liked', liked);
      likeButton.title = liked ? '取消红心' : '红心喜欢';
      toast(liked ? '已加入红心' : '已取消红心');
    } catch (error) { toast.error(error.message || '红心操作失败，请先登录网易云'); }
    finally { likeButton.disabled = false; }
  });

  async function syncCommentCount(song) {
    const token = ++commentToken;
    const target = commentTargetSong(song);
    if (!target) {
      setCommentCountDisplay(0);
      if (commentButton) {
        commentButton.classList.toggle('disabled', true);
        commentButton.title = isLocalSong(song) ? '本地歌曲需先匹配网易云' : '当前歌曲不支持评论';
      }
      return;
    }
    if (commentButton) {
      commentButton.classList.remove('disabled');
      commentButton.title = isLocalSong(song) ? '评论（匹配网易云）' : '评论';
    }
    try {
      const data = await fetchSongComments(target.id, 1, 0);
      if (token !== commentToken) return;
      setCommentCountDisplay(data.total || data.comments?.length || 0);
    } catch (_) {
      if (token !== commentToken) return;
      setCommentCountDisplay(0);
    }
  }

  commentButton?.addEventListener('click', async () => {
    const song = store.get().now;
    const target = commentTargetSong(song);
    if (!target) {
      if (isLocalSong(song)) {
        toast('本地歌曲请先匹配网易云曲目后再看评论');
        openLocalMatchModal(song);
      } else {
        toast('评论当前支持网易云歌曲');
      }
      return;
    }
    const modal = document.getElementById('comment-modal');
    const list = document.getElementById('comment-list');
    document.getElementById('comment-title').textContent = isLocalSong(song) ? '评论（匹配网易云）' : '评论';
    document.getElementById('comment-sub').textContent = `${target.name || song?.name || '当前歌曲'} · ${target.artist || song?.artist || ''}`;
    // 本地曲提供「重新匹配」入口
    let matchBtn = document.getElementById('comment-local-match');
    if (isLocalSong(song)) {
      if (!matchBtn) {
        matchBtn = document.createElement('button');
        matchBtn.type = 'button';
        matchBtn.id = 'comment-local-match';
        matchBtn.className = 'chip';
        matchBtn.textContent = '匹配在线歌曲';
        matchBtn.addEventListener('click', () => {
          close('comment-modal');
          openLocalMatchModal(store.get().now);
        });
        document.querySelector('#comment-modal .modal-head > div')?.appendChild(matchBtn);
      }
      matchBtn.hidden = false;
      matchBtn.textContent = song.onlineMetadata ? '重新匹配' : '匹配在线歌曲';
    } else if (matchBtn) {
      matchBtn.hidden = true;
    }

    clear(list);
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = '正在读取评论…';
    list.appendChild(loading);
    modal.hidden = false;
    try {
      const data = await fetchSongComments(target.id, 30, 0);
      clear(list);
      setCommentCountDisplay(data.total || data.comments?.length || 0);
      const comments = Array.isArray(data.comments) ? data.comments : [];
      if (!comments.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '暂无评论';
        list.appendChild(empty);
        return;
      }
      comments.forEach((comment) => {
        const row = document.createElement('article'); row.className = 'comment-item';
        const avatar = document.createElement('img'); avatar.alt = ''; avatar.loading = 'lazy';
        if (comment.user?.avatar) avatar.src = coverUrl(comment.user.avatar, 80);
        const copy = document.createElement('div');
        const author = document.createElement('div'); author.className = 'comment-author';
        author.textContent = comment.user?.nickname || '网易云用户';
        const content = document.createElement('div'); content.className = 'comment-content';
        content.textContent = comment.content || '';
        const meta = document.createElement('div'); meta.className = 'comment-meta';
        meta.textContent = `${comment.time ? new Date(comment.time).toLocaleString() : ''}${comment.likedCount ? ` · ${comment.likedCount} 赞` : ''}`;
        copy.append(author, content, meta); row.append(avatar, copy); list.appendChild(row);
      });
    } catch (error) {
      clear(list);
      const line = document.createElement('div');
      line.className = 'error-line';
      line.textContent = error.message || '评论读取失败';
      list.appendChild(line);
    }
  });

  collectButton?.addEventListener('click', async () => {
    const song = store.get().now;
    const target = commentTargetSong(song);
    if (!target) {
      if (isLocalSong(song)) {
        toast('本地歌曲请先匹配网易云曲目后再收藏');
        openLocalMatchModal(song);
      } else {
        toast('收藏到歌单当前支持网易云歌曲');
      }
      return;
    }
    const modal = document.getElementById('collect-modal');
    const list = document.getElementById('collect-list');
    const status = document.getElementById('collect-status');
    modal.hidden = false; clear(list); status.hidden = false; status.textContent = '正在读取歌单…';
    try {
      const data = await fetchUserPlaylists('netease');
      const playlists = (data.playlists || []).filter((item) => !item.subscribed);
      status.hidden = playlists.length > 0;
      status.textContent = playlists.length ? '选择要加入的歌单' : '没有可写入的自建歌单';
      playlists.forEach((item) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'collect-item';
        const img = document.createElement('img'); img.alt = ''; if (item.cover) img.src = coverUrl(item.cover, 90);
        const copy = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = item.name || '未命名歌单';
        const meta = document.createElement('span'); meta.textContent = `${item.trackCount || 0} 首`;
        copy.append(title, meta); button.append(img, copy);
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await addSongToPlaylist(item.id, target.id);
            close('collect-modal');
            toast(`已加入「${item.name || '歌单'}」`);
          } catch (error) {
            toast.error(error.message || '加入歌单失败');
          } finally {
            button.disabled = false;
          }
        });
        list.appendChild(button);
      });
    } catch (error) {
      status.textContent = error.message || '歌单读取失败，请先登录网易云';
    }
  });

  // 底部信息区双击打开匹配（本地曲）
  document.querySelector('.transport-meta')?.addEventListener('dblclick', () => {
    const song = store.get().now;
    if (isLocalSong(song)) openLocalMatchModal(song);
  });

  document.getElementById('comment-close')?.addEventListener('click', () => close('comment-modal'));
  document.getElementById('collect-close')?.addEventListener('click', () => close('collect-modal'));
  document.getElementById('comment-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'comment-modal') close('comment-modal');
  });
  document.getElementById('collect-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'collect-modal') close('collect-modal');
  });
  const initial = store.get().now;
  if (initial) {
    syncLike(initial);
    syncCommentCount(initial);
  } else {
    setCommentCountDisplay(0);
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close('comment-modal');
      close('collect-modal');
    }
  });
  bus.on('song-change', (song) => {
    syncLike(song);
    syncCommentCount(song);
  });
  bus.on('local-metadata', ({ song }) => {
    const now = store.get().now;
    if (!song || !now || song.localKey !== now.localKey) return;
    syncLike(now);
    syncCommentCount(now);
  });
}
