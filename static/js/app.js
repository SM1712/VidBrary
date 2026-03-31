/**
 * Vidbrary v2 — Full-featured Video Downloader & Library
 */

// ─── State ─────────────────────────────────────────────
let currentPage = 'download';
let videoInfo = null;
let selectedFormat = 'mp4';
let selectedSubLangs = [];
let currentView = 'grid';
let currentFolderId = null;
let contextVideoId = null;
let folders = [];
let pollTimers = {};
let currentPlayerId = null;
let playerQueue = [];
let libraryCache = [];
let progressSaveTimer = null;

const LANGS = {
    en:'English',es:'Español',fr:'Français',de:'Deutsch',it:'Italiano',
    pt:'Português',ru:'Русский',ja:'日本語',ko:'한국어',zh:'中文',
    'zh-Hans':'中文简',  'zh-Hant':'中文繁',ar:'العربية',hi:'हिन्दी',
    tr:'Türkçe',nl:'Nederlands',pl:'Polski',sv:'Svenska',da:'Dansk',
    no:'Norsk',fi:'Suomi',el:'Ελληνικά',cs:'Čeština',ro:'Română',
    hu:'Magyar',th:'ไทย',vi:'Tiếng Việt',id:'Indonesia',uk:'Українська',
    'pt-BR':'Português BR','es-419':'Español LATAM',
};

// ─── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadFolders();
    loadStats();
    setupFormats();
    setupColors();
    setupSubToggle();
    setupKeys();
    setInterval(pollActive, 2500);
});

// ─── Theme ─────────────────────────────────────────────
function loadTheme() {
    const t = localStorage.getItem('vb-theme') || 'dark';
    document.body.setAttribute('data-theme', t);
    updateThemeIcons(t);
}

function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('vb-theme', next);
    updateThemeIcons(next);
}

function updateThemeIcons(t) {
    const cls = t === 'dark' ? 'ri-sun-line' : 'ri-moon-line';
    document.querySelectorAll('#themeIcon, #themeToggleMobile i').forEach(i => {
        i.className = cls;
    });
}

// ─── Sidebar (mobile) ─────────────────────────────────
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('show');
}

// ─── Navigation ────────────────────────────────────────
function switchPage(page, e) {
    if (e) e.preventDefault();
    currentPage = page;

    // Update nav items
    document.querySelectorAll('.nav-item,.bnav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === page);
    });

    // Show page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.add('active');

    if (page === 'library') loadLibrary();
    if (page === 'history') loadHistory();

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
}

// ─── Format Selector ──────────────────────────────────
function setupFormats() {
    document.querySelectorAll('#formatSelector .chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#formatSelector .chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedFormat = btn.dataset.format;
            updateQuality();
        });
    });
}

function setupColors() {
    document.querySelectorAll('#colorPicker .color-dot').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#colorPicker .color-dot').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function setupSubToggle() {
    document.getElementById('subtitleToggle').addEventListener('change', e => {
        document.getElementById('subtitleLangs').classList.toggle('hidden', !e.target.checked);
        if (!e.target.checked) selectedSubLangs = [];
    });
}

function setupKeys() {
    document.getElementById('urlInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') analyzeUrl();
    });
    document.addEventListener('click', () => {
        document.getElementById('contextMenu').classList.add('hidden');
    });
}

// ─── Analyze URL ──────────────────────────────────────
async function analyzeUrl() {
    const url = document.getElementById('urlInput').value.trim();
    if (!url) return;

    show('analyzeLoading'); hide('analyzeError'); hide('videoPreview');
    document.getElementById('analyzeBtn').disabled = true;

    try {
        const data = await api('/api/analyze', { url });
        videoInfo = data;
        showPreview(data);
    } catch (e) {
        document.getElementById('analyzeErrorText').textContent = e.message;
        show('analyzeError');
    } finally {
        hide('analyzeLoading');
        document.getElementById('analyzeBtn').disabled = false;
    }
}

function showPreview(info) {
    document.getElementById('previewThumb').src = info.thumbnail || '';
    document.getElementById('previewTitle').textContent = info.title;
    document.getElementById('previewChannel').textContent = info.channel;
    document.getElementById('previewDesc').textContent = info.description;

    const dur = info.duration || 0;
    document.getElementById('previewDuration').textContent = fmtDur(dur);

    // Playlist
    const badge = document.getElementById('playlistBadge');
    const details = document.getElementById('playlistEntries');
    if (info.is_playlist) {
        badge.classList.remove('hidden');
        document.getElementById('playlistCount').textContent = `${info.playlist_count} videos`;
        if (info.entries?.length) {
            details.classList.remove('hidden');
            document.getElementById('entriesList').innerHTML = info.entries.map((e, i) => `
                <div class="entry-row">
                    <span class="entry-num">${i + 1}</span>
                    ${e.thumbnail ? `<img class="entry-img" src="${e.thumbnail}" alt="" loading="lazy">` : '<span class="entry-img"></span>'}
                    <span class="entry-name">${esc(e.title)}</span>
                    <span class="entry-dur">${fmtDur(e.duration || 0)}</span>
                </div>
            `).join('');
        }
    } else {
        badge.classList.add('hidden');
        details.classList.add('hidden');
    }

    updateQuality();
    renderSubLangs(info.subtitles || {});
    updateFolderSelects();
    show('videoPreview');
}

function updateQuality() {
    const sel = document.getElementById('qualitySelect');
    const grp = document.getElementById('qualityGroup');
    sel.innerHTML = '';

    if (selectedFormat === 'mp3') { grp.style.display = 'none'; return; }
    grp.style.display = '';
    if (!videoInfo) return;

    sel.innerHTML = '<option value="bestvideo+bestaudio/best">Mejor calidad</option>';
    videoInfo.video_formats.forEach(f => {
        const sz = f.filesize ? ` (~${fmtSize(f.filesize)})` : '';
        sel.innerHTML += `<option value="bestvideo[height<=${f.height}]+bestaudio/best[height<=${f.height}]">${f.quality} - ${f.ext.toUpperCase()}${sz}</option>`;
    });
}

function renderSubLangs(subs) {
    const container = document.getElementById('subtitleLangs');
    const group = document.getElementById('subtitleGroup');
    selectedSubLangs = [];
    const keys = Object.keys(subs);
    if (!keys.length) { group.style.display = 'none'; return; }
    group.style.display = '';

    keys.sort((a, b) => {
        if (subs[a].type !== subs[b].type) return subs[a].type === 'manual' ? -1 : 1;
        return (LANGS[a] || a).localeCompare(LANGS[b] || b);
    });

    container.innerHTML = keys.map(l => {
        const auto = subs[l].type === 'auto' ? '<span class="sub-auto"> auto</span>' : '';
        return `<button class="sub-chip" data-lang="${l}" onclick="toggleSub(this,'${l}')">${LANGS[l] || l}${auto}</button>`;
    }).join('');
}

function toggleSub(btn, lang) {
    btn.classList.toggle('active');
    if (selectedSubLangs.includes(lang)) selectedSubLangs = selectedSubLangs.filter(l => l !== lang);
    else selectedSubLangs.push(lang);
}

// ─── Start Download ───────────────────────────────────
async function startDownload() {
    if (!videoInfo) return;
    const btn = document.getElementById('downloadBtn');
    btn.disabled = true;

    const qualSel = document.getElementById('qualitySelect');
    const qualLabel = qualSel.options[qualSel.selectedIndex]?.text || 'best';

    try {
        const data = await api('/api/download', {
            url: videoInfo.url,
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            channel: videoInfo.channel,
            format: selectedFormat === 'mp3' ? 'bestaudio/best' : (qualSel.value || 'bestvideo+bestaudio/best'),
            output_format: selectedFormat,
            quality: qualLabel,
            folder_id: document.getElementById('folderSelect').value || null,
            auto_channel_folder: document.getElementById('autoChannelToggle').checked,
            download_subs: document.getElementById('subtitleToggle').checked,
            subtitle_langs: selectedSubLangs,
        });
        toast(`Descarga iniciada: ${videoInfo.title}`, 'info');
        trackDl(data.download_id, videoInfo.title);
    } catch (e) {
        toast(`Error: ${e.message}`, 'err');
    } finally {
        btn.disabled = false;
    }
}

// ─── Download Tracking ────────────────────────────────
function trackDl(id, title) {
    show('activeDownloadsTitle');
    const list = document.getElementById('downloadsList');
    const div = document.createElement('div');
    div.className = 'dl-item';
    div.id = `dl-${id}`;
    div.innerHTML = `
        <div class="dl-head">
            <span class="dl-title">${esc(title)}</span>
            <span class="dl-badge dl-badge-starting">Iniciando</span>
        </div>
        <div class="dl-bar"><div class="dl-bar-fill" style="width:0%"></div></div>
        <div class="dl-meta">
            <span class="dl-pct">0%</span>
            <span class="dl-speed"></span>
            <span class="dl-eta"></span>
        </div>
    `;
    list.prepend(div);

    const timer = setInterval(async () => {
        try {
            const d = await api(`/api/download/${id}/status`, null, 'GET');
            updateDlUI(id, d);
            if (d.status === 'completed' || d.status === 'error') {
                clearInterval(timer);
                delete pollTimers[id];
                if (d.status === 'completed') {
                    toast(`Completado: ${title}`, 'ok');
                    if (currentPage === 'library') loadLibrary();
                    loadStats(); loadFolders();
                } else {
                    toast(`Error: ${d.error || 'Desconocido'}`, 'err');
                }
            }
        } catch (_) {}
    }, 1200);
    pollTimers[id] = timer;
}

function updateDlUI(id, d) {
    const el = document.getElementById(`dl-${id}`);
    if (!el) return;
    const labels = { starting:'Iniciando', pending:'En cola', downloading:'Descargando', processing:'Procesando', completed:'Completado', error:'Error' };
    el.querySelector('.dl-badge').textContent = labels[d.status] || d.status;
    el.querySelector('.dl-badge').className = `dl-badge dl-badge-${d.status}`;
    const pct = d.progress || 0;
    const bar = el.querySelector('.dl-bar-fill');
    bar.style.width = `${pct}%`;
    if (d.status === 'completed') bar.classList.add('ok');
    else if (d.status === 'error') bar.classList.add('err');
    el.querySelector('.dl-pct').textContent = `${pct}%`;
    if (d.speed) el.querySelector('.dl-speed').textContent = d.speed;
    if (d.eta) el.querySelector('.dl-eta').textContent = `ETA: ${d.eta}`;
}

async function pollActive() {
    try {
        const data = await api('/api/downloads/active', null, 'GET');
        for (const [id] of Object.entries(data)) {
            if (!document.getElementById(`dl-${id}`)) trackDl(id, 'Descarga');
        }
    } catch (_) {}
}

// ─── Library ──────────────────────────────────────────
async function loadLibrary() {
    const [sort, order] = document.getElementById('librarySort').value.split('-');
    const search = document.getElementById('librarySearch')?.value || '';
    const watchFilter = document.getElementById('watchFilter')?.value || '';

    let url = `/api/library?sort=${sort}&order=${order}`;
    if (currentFolderId) url += `&folder_id=${currentFolderId}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (watchFilter) url += `&watch=${watchFilter}`;

    try {
        const videos = await api(url, null, 'GET');
        libraryCache = videos;
        const content = document.getElementById('libraryContent');
        const empty = document.getElementById('libraryEmpty');

        if (!videos.length) {
            content.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        content.innerHTML = videos.map(v => renderCard(v)).join('');
        content.className = currentView === 'list' ? 'library-grid list-view' : 'library-grid';
    } catch (_) {
        toast('Error al cargar biblioteca', 'err');
    }
    loadLibStats();
}

function renderCard(v) {
    const deleted = v.is_deleted ? true : false;
    const size = v.file_size ? fmtSize(v.file_size) : '';
    const watched = v.is_watched ? true : false;
    const wp = v.watch_percent || 0;
    const hasProgress = wp > 0 && !watched;
    const thumbErr = `this.style.background='var(--card-img-bg)';this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22/>'`;
    return `
        <div class="v-card ${watched ? 'is-watched' : ''}" ondblclick="${deleted ? `redownload('${v.id}')` : `openPlayer('${v.id}')`}" oncontextmenu="showCtx(event,'${v.id}')">
            <div class="v-thumb">
                <img src="${v.thumbnail || ''}" alt="" loading="lazy" onerror="${thumbErr}">
                <div class="v-play" onclick="${deleted ? `redownload('${v.id}')` : `openPlayer('${v.id}')`}">
                    <i class="${deleted ? 'ri-refresh-line' : 'ri-play-fill'}"></i>
                </div>
                ${v.duration ? `<span class="v-dur">${v.duration}</span>` : ''}
                ${v.format ? `<span class="v-fmt">${v.format}</span>` : ''}
                ${deleted ? `<span class="v-deleted-badge"><i class="ri-error-warning-line"></i> Eliminado</span>` : ''}
                ${watched ? `<span class="v-watched-badge"><i class="ri-check-double-line"></i> Visto</span>` : ''}
                ${(wp > 0) ? `<div class="v-watch-bar"><div class="v-watch-fill ${watched ? 'complete' : ''}" style="width:${wp}%"></div></div>` : ''}
            </div>
            <div class="v-info">
                <div class="v-title">${esc(v.title)}</div>
                <div class="v-channel"><i class="ri-user-line"></i> ${esc(v.channel || '')}</div>
                <div class="v-bottom">
                    <span>${hasProgress ? `<span class="resume-badge"><i class="ri-play-circle-line"></i> ${Math.round(wp)}%</span>` : (v.downloaded_at ? fmtDate(v.downloaded_at) : '')}</span>
                    ${size ? `<span class="v-size">${size}</span>` : ''}
                </div>
            </div>
            <div class="v-more">
                <button class="btn-icon-sm" onclick="event.stopPropagation();showCtx(event,'${v.id}')">
                    <i class="ri-more-2-fill"></i>
                </button>
            </div>
        </div>
    `;
}

async function loadLibStats() {
    try {
        const d = await api('/api/stats', null, 'GET');
        document.getElementById('libraryStats').innerHTML = `
            <span class="stat-pill"><i class="ri-film-line"></i> ${d.total_videos} videos</span>
            <span class="stat-pill"><i class="ri-hard-drive-3-line"></i> ${fmtSize(d.total_size)}</span>
            <span class="stat-pill"><i class="ri-folder-3-line"></i> ${d.total_folders} carpetas</span>
        `;
    } catch (_) {}
}

function searchLibrary() {
    clearTimeout(window._st);
    window._st = setTimeout(() => loadLibrary(), 300);
}

function setView(v) {
    currentView = v;
    document.querySelectorAll('.view-btns .btn-icon-sm').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    const c = document.getElementById('libraryContent');
    c.className = v === 'list' ? 'library-grid list-view' : 'library-grid';
}

// ─── YouTube-like Player ──────────────────────────────
async function openPlayer(videoId) {
    const video = libraryCache.find(v => v.id === videoId);
    if (!video || video.is_deleted) return;

    // Save progress of previous video before switching
    if (currentPlayerId && currentPlayerId !== videoId) {
        saveProgress();
    }

    currentPlayerId = videoId;

    // Build smart queue: unwatched first, then watched
    const available = libraryCache.filter(v => !v.is_deleted);
    const unwatched = available.filter(v => !v.is_watched);
    const watched = available.filter(v => v.is_watched);
    playerQueue = [...unwatched, ...watched];

    // Update UI
    const player = document.getElementById('videoPlayer');
    player.src = `/api/library/${videoId}/open`;

    document.getElementById('playerTitle').textContent = video.title;
    document.getElementById('playerChannel').textContent = video.channel || '';
    document.getElementById('playerQuality').textContent = `${video.format?.toUpperCase() || ''} ${video.quality || ''}`.trim();
    document.getElementById('playerDesc').textContent = video.description || '';

    // Render queue
    renderQueue();

    // Restore saved position
    try {
        const prog = await api(`/api/library/${videoId}/progress`, null, 'GET');
        if (prog.position > 0 && prog.percent < 95) {
            player.addEventListener('loadedmetadata', function onMeta() {
                player.currentTime = prog.position;
                player.removeEventListener('loadedmetadata', onMeta);
            });
        }
    } catch (_) {}

    // Save progress periodically while playing
    player.ontimeupdate = () => {
        clearTimeout(progressSaveTimer);
        progressSaveTimer = setTimeout(() => saveProgress(), 5000);
    };

    // Save on pause
    player.onpause = () => saveProgress();

    // Autoplay next on end — mark as watched and go next
    player.onended = () => {
        markWatched(videoId, true);
        if (document.getElementById('autoplayToggle').checked) {
            playerAction('next');
        }
    };

    // Switch to player page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-player').classList.add('active');
    document.querySelectorAll('.nav-item,.bnav-item').forEach(n => n.classList.remove('active'));

    player.play().catch(() => {});
}

function saveProgress() {
    if (!currentPlayerId) return;
    const player = document.getElementById('videoPlayer');
    if (!player.duration || player.duration === Infinity) return;
    api(`/api/library/${currentPlayerId}/progress`, {
        position: player.currentTime,
        duration: player.duration,
    }).catch(() => {});
}

async function markWatched(videoId, watched) {
    try {
        await api(`/api/library/${videoId}/watched`, { watched });
        // Update local cache
        const v = libraryCache.find(x => x.id === videoId);
        if (v) v.is_watched = watched ? 1 : 0;
    } catch (_) {}
}

function renderQueue() {
    const q = document.getElementById('playerQueue');
    q.innerHTML = playerQueue.map(v => {
        const active = v.id === currentPlayerId ? 'q-active' : '';
        const watched = v.is_watched;
        const wp = v.watch_percent || 0;
        const thumbErr = `this.style.background='var(--card-img-bg)'`;
        return `
            <div class="q-item ${active}" onclick="openPlayer('${v.id}')">
                ${!watched && wp > 0 ? '<span class="q-progress-dot"></span>' : ''}
                <img class="q-img" src="${v.thumbnail || ''}" alt="" loading="lazy" onerror="${thumbErr}">
                <span class="q-title">${esc(v.title)}</span>
                ${watched ? '<i class="q-watched ri-check-double-line"></i>' : ''}
                <span class="q-dur">${v.duration || ''}</span>
            </div>
        `;
    }).join('');

    // Scroll active into view
    const activeEl = q.querySelector('.q-active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function playerAction(action) {
    const idx = playerQueue.findIndex(v => v.id === currentPlayerId);
    if (action === 'next' && idx < playerQueue.length - 1) {
        openPlayer(playerQueue[idx + 1].id);
    } else if (action === 'prev' && idx > 0) {
        openPlayer(playerQueue[idx - 1].id);
    }
}

function closePlayer() {
    saveProgress(); // Save before leaving
    const player = document.getElementById('videoPlayer');
    player.pause();
    player.src = '';
    currentPlayerId = null;
    switchPage('library');
}

// ─── Re-download ──────────────────────────────────────
async function redownload(videoId) {
    if (!confirm('El archivo fue eliminado. ¿Deseas volver a descargarlo?')) return;
    try {
        const data = await api('/api/library/redownload', { video_id: videoId });
        toast('Re-descarga iniciada', 'info');
        trackDl(data.download_id, 'Re-descarga');
        switchPage('download');
    } catch (e) {
        toast(`Error: ${e.message}`, 'err');
    }
}

// ─── Context Menu ─────────────────────────────────────
function showCtx(e, videoId) {
    e.preventDefault();
    e.stopPropagation();
    contextVideoId = videoId;

    // Update watch toggle label
    const v = libraryCache.find(x => x.id === videoId);
    const label = document.getElementById('ctxWatchLabel');
    const icon = document.getElementById('ctxWatchBtn')?.querySelector('i');
    if (v?.is_watched) {
        label.textContent = 'Marcar como no visto';
        if (icon) icon.className = 'ri-eye-off-line';
    } else {
        label.textContent = 'Marcar como visto';
        if (icon) icon.className = 'ri-eye-line';
    }

    const menu = document.getElementById('contextMenu');
    menu.classList.remove('hidden');
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 160)}px`;
}

async function ctxAction(action) {
    document.getElementById('contextMenu').classList.add('hidden');
    if (!contextVideoId) return;

    const v = libraryCache.find(x => x.id === contextVideoId);

    if (action === 'play') {
        if (v?.is_deleted) redownload(contextVideoId);
        else openPlayer(contextVideoId);
    } else if (action === 'move') {
        showMoveModal(contextVideoId);
    } else if (action === 'toggleWatch') {
        const newState = !v?.is_watched;
        await markWatched(contextVideoId, newState);
        toast(newState ? 'Marcado como visto' : 'Marcado como no visto', 'ok');
        loadLibrary();
    } else if (action === 'delete') {
        if (!confirm('¿Eliminar este video?')) return;
        try {
            await api(`/api/library/${contextVideoId}`, null, 'DELETE');
            toast('Video eliminado', 'ok');
            loadLibrary(); loadStats(); loadFolders();
        } catch (_) { toast('Error al eliminar', 'err'); }
    }
}

// ─── Move Modal ───────────────────────────────────────
function showMoveModal(videoId) {
    contextVideoId = videoId;
    const list = document.getElementById('moveFolderList');
    let html = `<div class="move-item" onclick="moveTo(null)"><i class="ri-home-4-line"></i> Sin carpeta (raíz)</div>`;
    folders.forEach(f => {
        html += `<div class="move-item" onclick="moveTo('${f.id}')"><span class="folder-dot" style="background:${f.color}"></span> ${esc(f.name)}</div>`;
    });
    list.innerHTML = html;
    show('moveModal');
}
function closeMoveModal() { hide('moveModal'); }

async function moveTo(folderId) {
    try {
        await api(`/api/library/${contextVideoId}/move`, { folder_id: folderId });
        toast('Video movido', 'ok');
        closeMoveModal();
        loadLibrary(); loadFolders();
    } catch (_) { toast('Error al mover', 'err'); }
}

// ─── Folders ──────────────────────────────────────────
async function loadFolders() {
    try {
        folders = await api('/api/folders', null, 'GET');
        renderTree();
        updateFolderSelects();
    } catch (_) {}
}

function renderTree() {
    const tree = document.getElementById('folderTree');
    const roots = folders.filter(f => !f.parent_id);
    const childMap = {};
    folders.forEach(f => { if (f.parent_id) (childMap[f.parent_id] ??= []).push(f); });

    let html = `<div class="folder-item ${!currentFolderId ? 'active' : ''}" onclick="filterFolder(null)">
        <i class="ri-film-line" style="color:var(--accent);font-size:14px"></i>
        <span>Todos</span>
    </div>`;

    function render(f, depth = 0) {
        const kids = childMap[f.id] || [];
        let h = `<div class="folder-item ${currentFolderId === f.id ? 'active' : ''}" style="padding-left:${14 + depth * 14}px" onclick="filterFolder('${f.id}')">
            <span class="folder-dot" style="background:${f.color}"></span>
            <span>${esc(f.name)}</span>
            <span class="folder-count">${f.video_count || 0}</span>
            <span class="folder-del" onclick="event.stopPropagation();delFolder('${f.id}')"><i class="ri-close-line"></i></span>
        </div>`;
        kids.forEach(c => h += render(c, depth + 1));
        return h;
    }
    roots.forEach(f => html += render(f));
    tree.innerHTML = html;
}

function filterFolder(id) {
    currentFolderId = id;
    renderTree();
    if (currentPage === 'library') loadLibrary();
    else switchPage('library');
}

function updateFolderSelects() {
    ['folderSelect', 'folderParent'].forEach(sid => {
        const sel = document.getElementById(sid);
        if (!sel) return;
        const val = sel.value;
        const def = sid === 'folderParent' ? 'Raíz' : 'Sin carpeta (raíz)';
        sel.innerHTML = `<option value="">${def}</option>` + folders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
        sel.value = val;
    });
}

function showCreateFolder() {
    show('folderModal');
    const inp = document.getElementById('folderName');
    inp.value = '';
    inp.focus();
}
function closeFolderModal() { hide('folderModal'); }

async function createFolder() {
    const name = document.getElementById('folderName').value.trim();
    if (!name) return;
    const parent = document.getElementById('folderParent').value || null;
    const color = document.querySelector('#colorPicker .color-dot.active')?.dataset.color || '#0891b2';
    try {
        await api('/api/folders', { name, parent_id: parent, color });
        toast(`Carpeta "${name}" creada`, 'ok');
        closeFolderModal();
        loadFolders();
    } catch (_) { toast('Error al crear carpeta', 'err'); }
}

async function delFolder(id) {
    if (!confirm('¿Eliminar carpeta? Los videos irán a la raíz.')) return;
    try {
        await api(`/api/folders/${id}`, null, 'DELETE');
        toast('Carpeta eliminada', 'ok');
        if (currentFolderId === id) currentFolderId = null;
        loadFolders();
        if (currentPage === 'library') loadLibrary();
    } catch (_) { toast('Error', 'err'); }
}

// ─── History ──────────────────────────────────────────
async function loadHistory() {
    try {
        const history = await api('/api/history', null, 'GET');
        const list = document.getElementById('historyList');
        const empty = document.getElementById('historyEmpty');

        if (!history.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');

        list.innerHTML = history.map(h => {
            const icons = { completed:'ri-check-double-line', error:'ri-error-warning-line', pending:'ri-time-line', downloading:'ri-download-line' };
            return `
                <div class="h-item">
                    <div class="h-icon h-icon-${h.status}"><i class="${icons[h.status] || 'ri-time-line'}"></i></div>
                    <div class="h-info">
                        <div class="h-title">${esc(h.title || 'Sin título')}</div>
                        <div class="h-url">${esc(h.url)}</div>
                    </div>
                    <div class="h-date">${h.started_at ? fmtDate(h.started_at) : ''}</div>
                    <div class="h-actions">
                        ${h.status === 'error' ? `<button class="btn-icon-sm" title="Reintentar" onclick="retryFromHistory('${esc(h.url)}','${esc(h.title)}')"><i class="ri-refresh-line"></i></button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (_) { toast('Error al cargar historial', 'err'); }
}

function retryFromHistory(url, title) {
    document.getElementById('urlInput').value = url;
    switchPage('download');
    analyzeUrl();
}

async function clearHistory() {
    if (!confirm('¿Limpiar todo el historial?')) return;
    try {
        await api('/api/history/clear', {});
        toast('Historial limpiado', 'ok');
        loadHistory();
    } catch (_) {}
}

// ─── Stats ────────────────────────────────────────────
async function loadStats() {
    try {
        const d = await api('/api/stats', null, 'GET');
        document.getElementById('sidebarStats').innerHTML = `
            <span><i class="ri-film-line"></i> ${d.total_videos} videos</span>
            <span><i class="ri-hard-drive-3-line"></i> ${fmtSize(d.total_size)}</span>
            <span><i class="ri-download-line"></i> ${d.total_downloads} descargas</span>
        `;
    } catch (_) {}
}

// ─── Toast ────────────────────────────────────────────
function toast(msg, type = 'info') {
    const wrap = document.getElementById('toastWrap');
    const icons = { ok: 'ri-check-double-line', err: 'ri-error-warning-line', info: 'ri-information-line' };
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${esc(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ─── Helpers ──────────────────────────────────────────
async function api(url, body, method) {
    const opts = {};
    if (body) {
        opts.method = 'POST';
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    if (method === 'GET') { /* default */ }
    else if (method === 'DELETE') { opts.method = 'DELETE'; }
    else if (body) { opts.method = 'POST'; }

    const resp = await fetch(url, opts);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error');
    return data;
}

function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function fmtSize(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function fmtDur(secs) {
    if (!secs) return '0:00';
    const s = secs % 60, m = Math.floor(secs / 60) % 60, h = Math.floor(secs / 3600);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'Z'), now = new Date(), diff = now - dt;
    if (diff < 60000) return 'Ahora';
    if (diff < 3600000) return `Hace ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `Hace ${Math.floor(diff / 86400000)}d`;
    return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
