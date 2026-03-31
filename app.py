"""
Vidbrary - The Ultimate Video Downloader & Library Manager
v2.0 - PWA, responsive, organized storage, autoplay, themes
"""

import os
import json
import sqlite3
import threading
import uuid
import re
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file

import yt_dlp

app = Flask(__name__)
BASE_DIR = Path(__file__).parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DB_PATH = BASE_DIR / "vidbrary.db"
DOWNLOADS_DIR.mkdir(exist_ok=True)

active_downloads = {}


def sanitize_filename(name):
    """Remove invalid filesystem characters."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = name.strip('. ')
    return name[:200] if name else 'unknown'


# ─── Database ───────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            color TEXT DEFAULT '#0891b2',
            icon TEXT DEFAULT 'folder',
            FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT,
            thumbnail TEXT,
            duration TEXT,
            duration_secs INTEGER DEFAULT 0,
            channel TEXT,
            description TEXT,
            file_path TEXT,
            file_size INTEGER DEFAULT 0,
            format TEXT,
            quality TEXT,
            folder_id TEXT,
            downloaded_at TEXT DEFAULT (datetime('now')),
            has_subtitles INTEGER DEFAULT 0,
            subtitle_lang TEXT,
            is_deleted INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS download_history (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT,
            thumbnail TEXT,
            channel TEXT,
            status TEXT DEFAULT 'pending',
            progress REAL DEFAULT 0,
            speed TEXT,
            eta TEXT,
            error TEXT,
            format TEXT,
            quality TEXT,
            started_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT,
            video_id TEXT
        );
    """)
    # Migrate: add columns if missing
    try:
        conn.execute("ALTER TABLE videos ADD COLUMN is_deleted INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE videos ADD COLUMN sort_order INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE videos ADD COLUMN duration_secs INTEGER DEFAULT 0")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE download_history ADD COLUMN thumbnail TEXT")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE download_history ADD COLUMN channel TEXT")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE download_history ADD COLUMN video_id TEXT")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE download_history ADD COLUMN format TEXT")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE download_history ADD COLUMN quality TEXT")
    except Exception:
        pass
    # Watch tracking columns
    for col, default in [
        ("watch_position REAL", "0"),
        ("watch_percent REAL", "0"),
        ("is_watched INTEGER", "0"),
        ("last_watched_at TEXT", "NULL"),
    ]:
        try:
            conn.execute(f"ALTER TABLE videos ADD COLUMN {col} DEFAULT {default}")
        except Exception:
            pass
    conn.commit()
    conn.close()


init_db()


# ─── Organized Storage ──────────────────────────────────────
def get_organized_path(channel, title, ext):
    """Create organized path: downloads/Channel Name/video-title.ext"""
    channel_dir = sanitize_filename(channel) if channel else "_Sin Canal"
    video_file = sanitize_filename(title) + f".{ext}"
    dir_path = DOWNLOADS_DIR / channel_dir
    dir_path.mkdir(parents=True, exist_ok=True)
    return str(dir_path / video_file)


# ─── yt-dlp Helpers ─────────────────────────────────────────
def get_available_formats(url):
    """Get available formats for a video."""
    ydl_opts = {"quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    is_playlist = info.get("_type") == "playlist"
    entries = info.get("entries", [info]) if is_playlist else [info]
    first_entry = entries[0] if entries else info

    subtitles = first_entry.get("subtitles", {})
    auto_captions = first_entry.get("automatic_captions", {})

    video_formats = []
    audio_formats = []
    seen_video = set()
    seen_audio = set()

    for f in first_entry.get("formats", []):
        vcodec = f.get("vcodec", "none")
        acodec = f.get("acodec", "none")
        height = f.get("height")
        tbr = f.get("tbr", 0) or 0
        filesize = f.get("filesize") or f.get("filesize_approx") or 0

        if vcodec != "none" and height:
            key = f"{height}p"
            if key not in seen_video:
                seen_video.add(key)
                video_formats.append({
                    "format_id": f.get("format_id", ""),
                    "quality": key,
                    "height": height,
                    "ext": f.get("ext", ""),
                    "filesize": filesize,
                    "tbr": tbr,
                })
        elif acodec != "none" and vcodec == "none":
            key = f"{int(tbr)}kbps" if tbr else f.get("format_id", "")
            if key not in seen_audio:
                seen_audio.add(key)
                audio_formats.append({
                    "format_id": f.get("format_id", ""),
                    "quality": key,
                    "ext": f.get("ext", ""),
                    "filesize": filesize,
                    "tbr": tbr,
                })

    video_formats.sort(key=lambda x: x.get("height", 0), reverse=True)
    audio_formats.sort(key=lambda x: x.get("tbr", 0), reverse=True)

    subtitle_langs = {}
    for lang, subs in subtitles.items():
        subtitle_langs[lang] = {"type": "manual", "formats": [s.get("ext", "") for s in subs]}
    for lang, subs in auto_captions.items():
        if lang not in subtitle_langs:
            subtitle_langs[lang] = {"type": "auto", "formats": [s.get("ext", "") for s in subs]}

    result = {
        "title": first_entry.get("title", "Unknown"),
        "thumbnail": first_entry.get("thumbnail", ""),
        "duration": first_entry.get("duration", 0),
        "channel": first_entry.get("uploader", first_entry.get("channel", "Unknown")),
        "description": (first_entry.get("description", "") or "")[:500],
        "url": first_entry.get("webpage_url", url),
        "is_playlist": is_playlist,
        "playlist_count": len(entries) if is_playlist else 1,
        "playlist_title": info.get("title", "") if is_playlist else "",
        "video_formats": video_formats,
        "audio_formats": audio_formats,
        "subtitles": subtitle_langs,
    }

    if is_playlist:
        result["entries"] = []
        for e in entries[:50]:
            if e:
                result["entries"].append({
                    "title": e.get("title", "Unknown"),
                    "thumbnail": e.get("thumbnail", ""),
                    "duration": e.get("duration", 0),
                    "url": e.get("webpage_url", e.get("url", "")),
                    "channel": e.get("uploader", e.get("channel", "")),
                })

    return result


def do_download(download_id, url, options):
    """Execute download in background thread."""
    folder_id = options.get("folder_id")
    auto_channel_folder = options.get("auto_channel_folder", False)
    subtitle_langs = options.get("subtitle_langs", [])
    download_subs = options.get("download_subs", False)
    format_choice = options.get("format", "bestvideo+bestaudio/best")
    output_format = options.get("output_format", "mp4")
    quality = options.get("quality", "best")

    # Temp output - we'll rename after
    outtmpl = str(DOWNLOADS_DIR / "%(uploader,channel)s" / "%(title)s.%(ext)s")

    ydl_opts = {
        "format": format_choice,
        "outtmpl": outtmpl,
        "merge_output_format": output_format if output_format != "mp3" else None,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": False,
    }

    if output_format == "mp3":
        ydl_opts["format"] = "bestaudio/best"
        ydl_opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "320",
        }]
        ydl_opts.pop("merge_output_format", None)

    if download_subs and subtitle_langs:
        ydl_opts["writesubtitles"] = True
        ydl_opts["subtitleslangs"] = subtitle_langs
        ydl_opts["writeautomaticsub"] = True
        if output_format != "mp3":
            ydl_opts["postprocessors"] = ydl_opts.get("postprocessors", []) + [
                {"key": "FFmpegEmbedSubtitle"}
            ]

    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            progress = (downloaded / total * 100) if total > 0 else 0
            speed = d.get("_speed_str", d.get("speed", ""))
            if isinstance(speed, (int, float)):
                speed = f"{speed / 1024 / 1024:.1f} MB/s"
            eta = d.get("_eta_str", d.get("eta", ""))
            if isinstance(eta, (int, float)):
                mins, secs = divmod(int(eta), 60)
                eta = f"{mins}:{secs:02d}"

            active_downloads[download_id] = {
                "status": "downloading",
                "progress": round(progress, 1),
                "speed": str(speed),
                "eta": str(eta),
            }
            conn = get_db()
            conn.execute(
                "UPDATE download_history SET progress=?, speed=?, eta=?, status='downloading' WHERE id=?",
                (round(progress, 1), str(speed), str(eta), download_id),
            )
            conn.commit()
            conn.close()

        elif d["status"] == "finished":
            active_downloads[download_id] = {
                "status": "processing",
                "progress": 100,
                "speed": "",
                "eta": "",
            }

    ydl_opts["progress_hooks"] = [progress_hook]

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        entries = info.get("entries", [info]) if info.get("_type") == "playlist" else [info]

        conn = get_db()
        for idx, entry in enumerate(entries):
            if not entry:
                continue

            channel = entry.get("uploader", entry.get("channel", "Unknown")) or "Unknown"
            title = entry.get("title", "Unknown")

            file_path = ydl.prepare_filename(entry)
            if output_format == "mp3":
                file_path = os.path.splitext(file_path)[0] + ".mp3"
            elif not os.path.exists(file_path):
                file_path = os.path.splitext(file_path)[0] + f".{output_format}"

            file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0

            duration_secs = entry.get("duration", 0) or 0
            mins, secs = divmod(int(duration_secs), 60)
            hours, mins = divmod(mins, 60)
            duration_str = f"{hours}:{mins:02d}:{secs:02d}" if hours else f"{mins}:{secs:02d}"

            # Auto-create channel folder if requested
            actual_folder_id = folder_id
            if auto_channel_folder:
                existing = conn.execute(
                    "SELECT id FROM folders WHERE name=? AND parent_id IS ?",
                    (channel, folder_id)
                ).fetchone()
                if existing:
                    actual_folder_id = existing["id"]
                else:
                    ch_folder_id = str(uuid.uuid4())
                    conn.execute(
                        "INSERT INTO folders (id, name, parent_id, color, icon) VALUES (?, ?, ?, '#0891b2', 'user')",
                        (ch_folder_id, channel, folder_id),
                    )
                    actual_folder_id = ch_folder_id

            video_id = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO videos (id, title, url, thumbnail, duration, duration_secs,
                   channel, description, file_path, file_size, format, quality, folder_id,
                   has_subtitles, subtitle_lang, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    video_id, title,
                    entry.get("webpage_url", url),
                    entry.get("thumbnail", ""),
                    duration_str, int(duration_secs),
                    channel,
                    (entry.get("description", "") or "")[:500],
                    file_path, file_size,
                    output_format, quality,
                    actual_folder_id,
                    1 if download_subs else 0,
                    ",".join(subtitle_langs) if subtitle_langs else None,
                    idx,
                ),
            )

            # Update history with video_id reference
            conn.execute(
                "UPDATE download_history SET video_id=?, thumbnail=?, channel=? WHERE id=?",
                (video_id, entry.get("thumbnail", ""), channel, download_id),
            )

        conn.execute(
            "UPDATE download_history SET status='completed', progress=100, completed_at=datetime('now') WHERE id=?",
            (download_id,),
        )
        conn.commit()
        conn.close()

        active_downloads[download_id] = {"status": "completed", "progress": 100, "speed": "", "eta": ""}

    except Exception as e:
        active_downloads[download_id] = {"status": "error", "progress": 0, "speed": "", "eta": "", "error": str(e)}
        conn = get_db()
        conn.execute("UPDATE download_history SET status='error', error=? WHERE id=?", (str(e), download_id))
        conn.commit()
        conn.close()


# ─── Routes ──────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze_url():
    data = request.json
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400
    try:
        info = get_available_formats(url)
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/download", methods=["POST"])
def start_download():
    data = request.json
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400

    download_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO download_history (id, url, title, status, thumbnail, channel, format, quality) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
        (download_id, url, data.get("title", "Unknown"), data.get("thumbnail", ""),
         data.get("channel", ""), data.get("output_format", "mp4"), data.get("quality", "best")),
    )
    conn.commit()
    conn.close()

    active_downloads[download_id] = {"status": "starting", "progress": 0, "speed": "", "eta": ""}

    thread = threading.Thread(target=do_download, args=(download_id, url, data), daemon=True)
    thread.start()

    return jsonify({"download_id": download_id})


@app.route("/api/download/<download_id>/status")
def download_status(download_id):
    if download_id in active_downloads:
        return jsonify(active_downloads[download_id])
    conn = get_db()
    row = conn.execute("SELECT * FROM download_history WHERE id=?", (download_id,)).fetchone()
    conn.close()
    if row:
        return jsonify({
            "status": row["status"], "progress": row["progress"],
            "speed": row["speed"] or "", "eta": row["eta"] or "", "error": row["error"] or "",
        })
    return jsonify({"error": "Not found"}), 404


@app.route("/api/downloads/active")
def get_active_downloads():
    return jsonify({did: info for did, info in active_downloads.items()
                    if info.get("status") in ("starting", "downloading", "processing")})


# ─── Library ─────────────────────────────────────────────────
@app.route("/api/library")
def get_library():
    folder_id = request.args.get("folder_id")
    search = request.args.get("search", "").strip()
    sort_by = request.args.get("sort", "downloaded_at")
    order = request.args.get("order", "DESC")

    watch_filter = request.args.get("watch")  # "watched", "unwatched", or None

    allowed_sorts = ["downloaded_at", "title", "channel", "file_size", "duration_secs", "sort_order", "last_watched_at"]
    if sort_by not in allowed_sorts:
        sort_by = "downloaded_at"
    if order not in ("ASC", "DESC"):
        order = "DESC"

    conn = get_db()
    query = "SELECT * FROM videos WHERE 1=1"
    params = []

    if folder_id:
        query += " AND folder_id = ?"
        params.append(folder_id)

    if search:
        query += " AND (title LIKE ? OR channel LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])

    if watch_filter == "watched":
        query += " AND is_watched = 1"
    elif watch_filter == "unwatched":
        query += " AND is_watched = 0"

    query += f" ORDER BY {sort_by} {order}"
    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = []
    for r in rows:
        d = dict(r)
        # Check if file still exists
        if d.get("file_path") and not os.path.exists(d["file_path"]):
            d["is_deleted"] = 1
        results.append(d)

    return jsonify(results)


@app.route("/api/library/<video_id>", methods=["DELETE"])
def delete_video(video_id):
    conn = get_db()
    video = conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
    if not video:
        conn.close()
        return jsonify({"error": "Not found"}), 404

    file_path = video["file_path"]
    if file_path and os.path.exists(file_path):
        os.remove(file_path)
        # Remove empty channel directory
        parent_dir = Path(file_path).parent
        if parent_dir != DOWNLOADS_DIR and parent_dir.exists():
            try:
                parent_dir.rmdir()
            except OSError:
                pass

    conn.execute("DELETE FROM videos WHERE id=?", (video_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/library/<video_id>/move", methods=["POST"])
def move_video(video_id):
    data = request.json
    conn = get_db()
    conn.execute("UPDATE videos SET folder_id=? WHERE id=?", (data.get("folder_id"), video_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/library/<video_id>/open")
def open_video(video_id):
    conn = get_db()
    video = conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
    conn.close()
    if not video or not video["file_path"] or not os.path.exists(video["file_path"]):
        return jsonify({"error": "File not found"}), 404
    return send_file(video["file_path"])


@app.route("/api/library/<video_id>/progress", methods=["GET"])
def get_watch_progress(video_id):
    """Get saved watch position for a video."""
    conn = get_db()
    video = conn.execute(
        "SELECT watch_position, watch_percent, is_watched FROM videos WHERE id=?",
        (video_id,),
    ).fetchone()
    conn.close()
    if not video:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "position": video["watch_position"] or 0,
        "percent": video["watch_percent"] or 0,
        "is_watched": video["is_watched"] or 0,
    })


@app.route("/api/library/<video_id>/progress", methods=["POST"])
def save_watch_progress(video_id):
    """Save watch position. Marks as watched when >= 90% viewed."""
    data = request.json
    position = data.get("position", 0)
    duration = data.get("duration", 0)
    percent = (position / duration * 100) if duration > 0 else 0
    is_watched = 1 if percent >= 90 else 0

    conn = get_db()
    conn.execute(
        """UPDATE videos SET watch_position=?, watch_percent=?,
           is_watched=CASE WHEN is_watched=1 THEN 1 ELSE ? END,
           last_watched_at=datetime('now')
           WHERE id=?""",
        (round(position, 1), round(percent, 1), is_watched, video_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "percent": round(percent, 1), "is_watched": is_watched})


@app.route("/api/library/<video_id>/watched", methods=["POST"])
def toggle_watched(video_id):
    """Manually toggle watched status."""
    data = request.json
    is_watched = 1 if data.get("watched", True) else 0
    conn = get_db()
    conn.execute(
        "UPDATE videos SET is_watched=?, last_watched_at=datetime('now') WHERE id=?",
        (is_watched, video_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/library/<video_id>/next")
def next_video(video_id):
    """Get next video in same folder for autoplay."""
    conn = get_db()
    video = conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
    if not video:
        conn.close()
        return jsonify({"error": "Not found"}), 404

    folder_id = video["folder_id"]
    if folder_id:
        next_v = conn.execute(
            """SELECT * FROM videos WHERE folder_id=? AND downloaded_at > ?
               ORDER BY downloaded_at ASC LIMIT 1""",
            (folder_id, video["downloaded_at"]),
        ).fetchone()
    else:
        next_v = conn.execute(
            """SELECT * FROM videos WHERE folder_id IS NULL AND downloaded_at > ?
               ORDER BY downloaded_at ASC LIMIT 1""",
            (video["downloaded_at"],),
        ).fetchone()

    conn.close()
    if next_v:
        return jsonify(dict(next_v))
    return jsonify(None)


@app.route("/api/library/redownload", methods=["POST"])
def redownload_video():
    """Re-download a video whose file was deleted."""
    data = request.json
    video_id = data.get("video_id")
    conn = get_db()
    video = conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
    conn.close()

    if not video:
        return jsonify({"error": "Video not found"}), 404

    # Start re-download using stored info
    download_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO download_history (id, url, title, status, thumbnail, channel) VALUES (?, ?, ?, 'pending', ?, ?)",
        (download_id, video["url"], video["title"], video["thumbnail"], video["channel"]),
    )
    conn.commit()
    conn.close()

    active_downloads[download_id] = {"status": "starting", "progress": 0, "speed": "", "eta": ""}

    opts = {
        "format": "bestvideo+bestaudio/best",
        "output_format": video["format"] or "mp4",
        "quality": video["quality"] or "best",
        "folder_id": video["folder_id"],
    }

    # Delete old record, new one will be created by download
    conn = get_db()
    conn.execute("DELETE FROM videos WHERE id=?", (video_id,))
    conn.commit()
    conn.close()

    thread = threading.Thread(target=do_download, args=(download_id, video["url"], opts), daemon=True)
    thread.start()

    return jsonify({"download_id": download_id})


# ─── Folders ─────────────────────────────────────────────────
@app.route("/api/folders")
def get_folders():
    conn = get_db()
    folders = conn.execute("SELECT * FROM folders ORDER BY name").fetchall()
    counts = conn.execute(
        "SELECT folder_id, COUNT(*) as count FROM videos WHERE folder_id IS NOT NULL GROUP BY folder_id"
    ).fetchall()
    conn.close()
    count_map = {r["folder_id"]: r["count"] for r in counts}
    return jsonify([{**dict(f), "video_count": count_map.get(f["id"], 0)} for f in folders])


@app.route("/api/folders", methods=["POST"])
def create_folder():
    data = request.json
    folder_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, color, icon) VALUES (?, ?, ?, ?, ?)",
        (folder_id, data.get("name", "New Folder"), data.get("parent_id"),
         data.get("color", "#0891b2"), data.get("icon", "folder")),
    )
    conn.commit()
    conn.close()
    return jsonify({"id": folder_id})


@app.route("/api/folders/<folder_id>", methods=["PUT"])
def update_folder(folder_id):
    data = request.json
    conn = get_db()
    conn.execute(
        "UPDATE folders SET name=?, color=?, icon=? WHERE id=?",
        (data.get("name"), data.get("color", "#0891b2"), data.get("icon", "folder"), folder_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/folders/<folder_id>", methods=["DELETE"])
def delete_folder(folder_id):
    conn = get_db()
    conn.execute("UPDATE videos SET folder_id=NULL WHERE folder_id=?", (folder_id,))
    conn.execute("UPDATE folders SET parent_id=NULL WHERE parent_id=?", (folder_id,))
    conn.execute("DELETE FROM folders WHERE id=?", (folder_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ─── History ─────────────────────────────────────────────────
@app.route("/api/history")
def get_history():
    conn = get_db()
    rows = conn.execute("SELECT * FROM download_history ORDER BY started_at DESC LIMIT 100").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/history/<history_id>", methods=["DELETE"])
def delete_history(history_id):
    conn = get_db()
    conn.execute("DELETE FROM download_history WHERE id=?", (history_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/history/clear", methods=["POST"])
def clear_history():
    conn = get_db()
    conn.execute("DELETE FROM download_history")
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ─── Stats ───────────────────────────────────────────────────
@app.route("/api/stats")
def get_stats():
    conn = get_db()
    total_videos = conn.execute("SELECT COUNT(*) as c FROM videos").fetchone()["c"]
    total_size = conn.execute("SELECT COALESCE(SUM(file_size), 0) as s FROM videos").fetchone()["s"]
    total_folders = conn.execute("SELECT COUNT(*) as c FROM folders").fetchone()["c"]
    total_downloads = conn.execute("SELECT COUNT(*) as c FROM download_history").fetchone()["c"]
    conn.close()
    return jsonify({
        "total_videos": total_videos, "total_size": total_size,
        "total_folders": total_folders, "total_downloads": total_downloads,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
