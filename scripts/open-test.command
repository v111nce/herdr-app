#!/usr/bin/env python3
"""Open this checkout's build with a fresh app home and a private core session."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    repo = Path(__file__).resolve().parent.parent
    target = Path(os.environ.get('CARGO_TARGET_DIR', str(repo / 'target')))
    if not target.is_absolute():
        target = repo / target
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=target / 'debug/herdr-app')
    parser.add_argument('--check', action='store_true', help='check executable paths without opening a window')
    args = parser.parse_args()
    binary = args.binary.resolve()
    core = Path(shutil.which('hc') or Path.home() / '.local/bin/hc')
    for executable in (binary, core):
        if not executable.is_file() or not os.access(executable, os.X_OK):
            parser.error(f'Executable not found: {executable}. Build with bash scripts/build-local-macos; hc must also be installed.')
    if args.check:
        print(f'App: {binary}\nCore: {core}\nReady for an isolated manual test.')
        return

    root = Path(tempfile.mkdtemp(prefix='herdr-manual-', dir='/var/tmp'))
    env = {k: v for k, v in os.environ.items() if not k.startswith('HC_')}
    # Keep the session short: macOS limits Unix socket paths to 103 bytes.
    env.update(HERDR_APP_HOME=str(root / 'home'), HC_SESSION='hm' + root.name[-6:],
               XDG_CONFIG_HOME=str(root / 'config'), XDG_STATE_HOME=str(root / 'state'),
               XDG_CACHE_HOME=str(root / 'cache'), XDG_DATA_HOME=str(root / 'data'), HERDR_APP_NO_SOUND='1')
    (root / 'home').mkdir()
    (root / 'home/settings.json').write_text(json.dumps({'telemetry': False, 'core': str(core)}))
    (root / 'home/shared.json').write_text(json.dumps({'frame.welcomed': True, 'layout': 'main'}))
    (root / 'run.json').write_text(json.dumps({
        'binary': str(binary), 'core': str(core), 'session': env['HC_SESSION'],
        'app_home': env['HERDR_APP_HOME'], 'state': env['XDG_STATE_HOME'],
    }, indent=2))
    print('测试目录：', root, flush=True)
    print('在新窗口测试 Rime Shift+Enter，或 Cmd+T 选择 Pi/Kimi 检查复制提示。完成后在测试窗口 Cmd+Q。', flush=True)

    def call(command):
        return subprocess.run([str(arg) for arg in command], env=env, capture_output=True, text=True, timeout=15)

    with (root / 'app.log').open('w') as log:
        app = subprocess.Popen([str(binary)], env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 20
            while True:
                out = call([binary, 'do', 'space.new', json.dumps({
                    'name': '开发测试 · Herdr', 'folder': str(repo), 'argv': ['/bin/zsh', '-f'],
                })])
                if out.returncode == 0:
                    print('隔离测试窗口已就绪。', flush=True)
                    break
                if app.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(out.stdout + out.stderr + '\n' + (root / 'app.log').read_text())
                time.sleep(0.25)
            app.wait()
        except KeyboardInterrupt:
            pass
        finally:
            # All commands below use this launch's unique session and scratch paths.
            if app.poll() is None:
                try:
                    call([binary, 'do', 'app.quit'])
                except subprocess.TimeoutExpired:
                    pass  # Startup failure may leave the private window unresponsive.
                try:
                    app.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    app.terminate()
                    app.wait(timeout=5)
            try:
                out = call([core, 'ls', '--json'])
                if out.returncode == 0:
                    for terminal in json.loads(out.stdout).get('terminals', []):
                        call([core, 'kill', terminal['address']])
            finally:
                call([core, 'server', 'stop'])
            print('测试窗口及其独立 core 已关闭；日志保留在测试目录。', flush=True)


if __name__ == '__main__':
    main()
