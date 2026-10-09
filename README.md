# Claude Usage History

A browser userscript that logs your Claude usage percentages while claude.ai is open and builds the week-by-week history that the Settings > Usage page does not keep.

This is an unofficial personal project. It is not affiliated with or endorsed by Anthropic.

## What you get

- **A small pill in the bottom-right corner of claude.ai** with the current numbers, for example `Week 18% · 5h 37%`.
- **A history panel** when you click the pill: for each limit, the current window, then completed windows with the average and the highest.
- **CSV export** of every recorded window.

## Install

The script runs in a desktop browser (Chrome, Edge or Firefox). It does not run in the Claude desktop or mobile app.

1. **Install Tampermonkey.** Open your browser's extension store, search for Tampermonkey and add it.
2. **Allow user scripts (Chrome and Edge only).** Right-click the Tampermonkey icon, choose **Manage extension** and turn on **Allow User Scripts**. On older browser versions the switch is called **Developer mode** and sits at the top right of the extensions page. Firefox users can skip this step.
3. **Copy the script.** Open `claude-usage-history.user.js`, select everything and copy it.
4. **Create the script in Tampermonkey.** Click the Tampermonkey icon and choose **Create a new script**. Delete the template text, paste what you copied, and save with Ctrl+S (Cmd+S on a Mac).
5. **Open Claude.** Open or reload claude.ai in the same browser while signed in. The pill appears within a few seconds.
6. **Check the numbers.** Click the pill and compare its percentages with Settings > Usage. They should match.

To update, open the script in the Tampermonkey Dashboard, replace its contents with the new version, save, and reload claude.ai.

## Troubleshooting

Open claude.ai and click the Tampermonkey icon.

- **The script is not listed, or the icon shows no count.** The script is not running. Recheck the **Allow User Scripts** step, confirm the script is in the Tampermonkey Dashboard with its switch on, then reload the tab.
- **The script is listed and on, but there is no pill.** Make sure you are on version 1.0.1 or later, which keeps the pill in place when the page rebuilds itself.
- **The pill says `usage n/a`.** Click it and read the "Last read failed" message. This usually means the usage data source changed.
- **Numbers look 100 times too small.** Change `SCALE` near the top of the script from `1` to `100`.

## How it works

- Every 10 minutes, while a claude.ai tab is open, the script reads the same usage figures the Settings > Usage page shows. The request is read-only and uses your existing sign-in.
- Each limit window (every five-hour session, every week) gets one record holding the highest percentage seen before it reset.
- Completed windows are averaged to give a figure such as "Average 53% · highest 63% · over 3 completed".

## Things to know

- **Unofficial data source.** The usage figures come from an undocumented endpoint that Anthropic can change at any time. If it changes, the pill shows `usage n/a` and nothing else breaks.
- **History starts when you install it.** Past weeks cannot be recovered. The first weekly figure appears after your next weekly reset.
- **It only records while a Claude tab is open in that browser.** Each reading is account-wide, so Claude Code and other devices are included, but a week can read low if no tab was open late in the week.
- **Data stays local.** History is stored in your browser and sent nowhere. The **Clear** button in the panel deletes it.

## Settings

These constants are near the top of the script.

| Setting | Default | Meaning |
|---|---|---|
| `POLL_MINUTES` | `10` | How often usage is read |
| `HISTORY_ROWS` | `8` | Completed windows shown per limit |
| `MAX_WINDOWS` | `600` | Stored windows per limit |
| `SCALE` | `1` | Multiplier applied to the reported percentage |

## License

MIT. See [LICENSE](LICENSE).
