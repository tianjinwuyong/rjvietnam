import shutil
    # WINDOWS DOES NOT SEARCH PATHEXT FOR A BARE NAME. `codex` is installed as
    # codex.cmd; CreateProcess looks for a literal `codex` and raises FileNotFound,
    # which this file then reports as "not on PATH" -- a lie that sends the reader to
    # reinstall a tool that is already installed. Resolve through shutil.which (the
    # same fix appproc.resolve applies to the app's own start command) and strip one
    # layer of surrounding quotes from each token, since shlex with posix=False keeps
    # them: `model_provider="deepseek"` must reach the agent as model_provider=deepseek.
    resolved = shutil.which(argv[0]) or argv[0]
    argv = [resolved] + [
        t[1:-1] if len(t) > 1 and t[0] == t[-1] and t[0] in "\"'" else t
        for t in argv[1:]
    ]