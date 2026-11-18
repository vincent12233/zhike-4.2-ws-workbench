# Isolated WebView2 renderer

This one-shot test program renders local fixture pages with the installed WebView2 runtime and an exclusive temporary profile. On an explicit close request, it closes the WebView2 control, waits for the SDK to report `BrowserProcessExited(Normal)` for the exact owned browser PID, and flushes the `closed` record. It then ends its own process through `Environment.Exit`. An interrupted render exits with code 1 even if the browser closed normally.

The Node runner independently verifies the process exit, stream closure, and release of the observed process identities under the original 30-second deadline. This verifies the isolated renderer and its Core cleanup. The shipping application's WinUI window and dispatcher shutdown require a separate native acceptance run.
