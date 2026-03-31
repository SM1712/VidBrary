"""
Vidbrary Launcher — Runs Flask in background with system tray icon.
This is the entry point for the .exe build.
"""

import os
import sys
import threading
import webbrowser
import socket

# ─── Fix paths for PyInstaller bundle ───────────────────
if getattr(sys, 'frozen', False):
    # Running as .exe — _MEIPASS is the temp extract folder
    BASE_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS

    # Point Flask to bundled templates/static
    os.environ['VIDBRARY_TEMPLATE_DIR'] = os.path.join(BUNDLE_DIR, 'templates')
    os.environ['VIDBRARY_STATIC_DIR'] = os.path.join(BUNDLE_DIR, 'static')

    # Put bundled ffmpeg in PATH so yt-dlp can find it
    ffmpeg_dir = os.path.join(BUNDLE_DIR, 'ffmpeg')
    if os.path.isdir(ffmpeg_dir):
        os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')

    # DB and downloads live next to the .exe (persistent)
    os.environ['VIDBRARY_DATA_DIR'] = BASE_DIR
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    os.environ['VIDBRARY_DATA_DIR'] = BASE_DIR


PORT = 5000
HOST = '0.0.0.0'  # Listen on all interfaces for LAN access


def find_free_port(start=5000):
    """Find a free port starting from `start`."""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return start


def get_local_ip():
    """Get this machine's LAN IP for mobile access."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('8.8.8.8', 80))
            return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'


def start_server(port):
    """Start Flask server."""
    # Import app here so env vars are set first
    from app import app
    app.run(host=HOST, port=port, debug=False, use_reloader=False)


def create_tray_icon(port):
    """Create system tray icon with menu."""
    import pystray
    from PIL import Image, ImageDraw

    # Create a simple icon (cyan circle with play triangle)
    def make_icon():
        img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Cyan circle
        draw.ellipse([4, 4, 60, 60], fill=(8, 145, 178, 255))
        # White play triangle
        draw.polygon([(24, 18), (24, 46), (48, 32)], fill=(255, 255, 255, 255))
        return img

    local_ip = get_local_ip()
    url_local = f'http://127.0.0.1:{port}'
    url_lan = f'http://{local_ip}:{port}'

    def open_browser(icon, item):
        webbrowser.open(url_local)

    def open_lan_info(icon, item):
        webbrowser.open(url_local)

    def quit_app(icon, item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem(f'Abrir Vidbrary', open_browser, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(f'PC:  {url_local}', open_browser, enabled=False),
        pystray.MenuItem(f'LAN: {url_lan}', open_lan_info, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem('Salir', quit_app),
    )

    icon = pystray.Icon('Vidbrary', make_icon(), 'Vidbrary', menu)
    return icon


def main():
    global PORT
    PORT = find_free_port(PORT)

    local_ip = get_local_ip()
    try:
        print(f'\n  Vidbrary - Video Downloader')
        print(f'  PC:    http://127.0.0.1:{PORT}')
        print(f'  LAN:   http://{local_ip}:{PORT}\n')
    except Exception:
        pass  # Silently skip if console encoding fails (windowed mode)

    # Start Flask in background thread
    server_thread = threading.Thread(target=start_server, args=(PORT,), daemon=True)
    server_thread.start()

    # Open browser after a short delay
    def delayed_open():
        import time
        time.sleep(1.5)
        webbrowser.open(f'http://127.0.0.1:{PORT}')

    threading.Thread(target=delayed_open, daemon=True).start()

    # Run tray icon on main thread (required by Windows)
    try:
        icon = create_tray_icon(PORT)
        icon.run()
    except Exception:
        # If pystray fails (no display, etc.), just keep running
        print('Tray icon not available, running in console mode.')
        print('Press Ctrl+C to stop.')
        try:
            server_thread.join()
        except KeyboardInterrupt:
            print('\nShutting down...')
            sys.exit(0)


if __name__ == '__main__':
    main()
