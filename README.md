# werm: Web-based terminal multiplexer

werm is a terminal multiplexer and emulator empowered by browser tabs and your
OS's desktop features.

**TL;DR** see [screenshots](https://github.com/google/werm/wiki/Screenshots)

Usually we would use a terminal multiplexer to maintain sessions and manage
multiple terminals remotely and even locally. So we cannot use
any window manager and browser features to navigate and handle them.

## More powerful terminals

But when your terminals are tabs, you can **search them**. When your
terminals have URLs, you can open them with **bookmarks**.
When your shells are first-class windows (and not panes in tmux or Screen),
you can distribute them between **multiple desktops and multiple monitors**
and **snap or tile them** in your display. You can even **automate
terminal actions and accelerate workflows** with Javascript.

The purpose of werm is to **expand those features** you already use.

This is not an officially supported Google product.

## FEATURES

 * Ability to jump to different sessions using Ctrl+Shift+A (Chrome tab-search
   feature)

 * **Macros** - Macros start with left or right alt and are a sequence of keys
   of arbitrary length. No chording is required when typing the macro activator
   sequence.

 * **Detachability** (close the tab and the shell is still alive)

 * **Pixel-perfect bitmap fonts** of various sizes which can even
   render on high-DPI screens without blur.

 * Multiple **shell profiles**, each cloneable and initialized with its own
   command or rc file

 * Profile name is in tab title so you can tab-search for it

 * Most of what is in hterm (the engine for chromeOS SSH App and Crostini
   terminals)

 * Works on any OS with a Chromium-based browser, including chromeOS and LaCros
   chromeOS

 * Operate a terminal on your local machine or a remote one with a local
   browser.

 * Shows active shell sessions and available profiles at
   `http://localhost:<port>/attach`. (This page can also be opened from a
   terminal with macros.)

 * Overloaded decorator keys for easier coding and shell interaction: can type
   certain characters more easily

   * Done by pressing L/R shift keys, L/R ctrl keys, without chording with other
     keys; or the menu key
   * Look for `deadkey_map` or `menu_key_inserts` in `index.html` to customize
     the inserted characters.

  * Keyboard layout remapping (search for `remap_keys` in `index.html` for an
    explanation)

## Quickstart

### Caveats

 * chromeOS is the most thoroughly tested client OS at this time. Essential
   functionality has been confirmed for clients on Windows, macOS, and Linux.

 * The Werm server, which is the local or remote machine running the terminals,
   only works on Linux for now.

 * Non-Chromium-based browsers are not supported for now.

### Instructions

 * On your local or remote Linux machine, clone this repo to a convenient place
   and build. I recommend `~/.local/werm/src`:

   ```
   $ mkdir -p ~/.local/werm
   $ cd ~/.local/werm
   $ git clone <repo_url> src
   $ cd src
   $ ./build
   ```

   The first time you build it will download Go to compile a third-party
   component. This takes a little longer. It keeps Go inside the werm directory.

   `~/.local/werm/src`, or wherever you choose to put the Werm source, is
   known as `$WERMSRCDIR`. This environment variable is available to all
   child processes of the server, including terminal sessions.

 * Start the server.

   **FOR THE WEB SERVER TO OPERATE THE LOCAL MACHINE**

   Run: `$ ./run --port=8090 --address=localhost`

   Note that any logged in user will be able to start a shell as the user, since
   the port is accessible on localhost.

   This is sufficient for single-user machines. The opened port can be accessed
   in a local web browser or remotely with local ssh port forwarding:

   ```
   $ ssh ... -L 8090:werm-server:8090
   ```

   **FOR THE WEB SERVER TO OPERATE A REMOTE MACHINE**, or your local machine on
   which other users may log in, you should host the server on a Unix domain
   socket (UDS) so only one user has access:

   ```
   $ umask 0077
   $ ./run --uds=/tmp/werm.$USER.sock
   ```

   And then use port forwarding in your SSH command arguments (works with Chrome
   SSH extension, and any port number) to connect from your local machine:

   ```
   $ ssh ... -L 8090:/tmp/werm.<USER>.sock
   ```

 * Open `localhost:8090` in your browser to get an ephemeral shell. This will
   terminate the shell as soon as the tab is closed or the connection is lost.

 * To open a persistent shell, use the `localhost:8090/attach` page. See
   [ATTACH PAGE](#attach-page) for details.

 * Rather than use the attach page to reconnect to a shell, you can also re-open
   the URL e.g. with a bookmark or Ctrl+Shift+T.

 * While any shell is open, type `laH T ` to start a new persistent shell

## How to read macro shortcuts

To understand macros cited in this guide, you will need to know how
to activate them with the noted shortcut. Each shortcut is a plain string with
an even number of characters (this is how they are expressed compactly in the
source in long lists).

This syntax is also important in defining your own macros.

Each macro starts with either left alt or right alt (`la` and `ra`).

Each key is represented by two characters, called a *mnemonic*. Even if a key
is a modifier such as alt, shift, or ctrl, there is no need to hold down the
modifier.

Left and right modifiers of each kind are distinguished in the shortcut, so you
have to press the right one. Here are the most common keys that are used in
shortcuts:

 * Capital letter followed by space, e.g. `X ` or `A ` indicates that alphabetic
   key.
 * Number followed by a space is that number on the top row of the keyboard.
 * Punctuation such as `[` or `,` followed by a space is the non-numpad key
   which inserts that punction.
 * Numpad keys are indicated by a `#` followed usually but not always by a
   numeric digit.
 * `la` and `ra` are the alt keys, `ls` and `rs` are shift, and `lc` and
   `rc` are control.
 * `sp` is the spacebar
 * `vs` is backslash (vertical pipe) key (reVerse Solidus)

`native_to_mn` in `index.html` defines the complete mapping between
mnemonics and the long-form name used by the JS Event API.

## BASIC USE

 * An ephemeral shell will terminate if you close the tab. You will create one
   simply by navigating to `http://localhost:<port>/`. To close an ephemeral
   shell, just use Ctrl+W or close the tab.

 * A persistent shell stays alive even when the tab closes or the connection is
   lost. Terminate such a shell with Ctrl+D or the `exit` command before closing
   the tab.

 * Press Shift+Backspace to send Ctrl+W (delete word) to the shell.

 * To add or remove macros, add it to the `macro_map` in `index.html` or a
   profile's JS code (see [PROFILES](#profiles)).

   The left-hand side is the macro shortcut or mnemonic.

   The right-hand side is the string to enter or function to invoke. Use `\r`
   for return. Do not use shortcut mnemonics like `es` (escape) here, just the
   raw string.

 * Fonts are changed with `raF N **` where `**` is `A ` to `J ` in roughly
   increasing size. E.g. press right-alt, F, N, A in sequence to choose the
   smallest font. Ctrl-= and Ctrl-minus also work to change zoom, though this
   will cause blur if it is not 200% or 300% zoom.

 * Meta (i.e. super, apple on MacOS, search on ChromeOS) key is used in place of
   Alt for the terminal process. This is to allow Alt to be used for the start
   of macros. Note that on ChromeOS and e.g. Windows, meta pressed alone cannot
   be intercepted by Javascript, so meta is not used for macros.

## ATTACH PAGE

Open the attach page by going to `http://localhost:8090/attach`, or using the
`rarsS T ` or `rarsA T ` macros from within a terminal (see HOW TO READ MACRO
SHORTCUTS). The former shortcut uses a new tab (Separate) while the latter
replaces the current tab.

From the attach page you can create or reconnect to persistent sessions.

 * use a link in the "Existing" section to open an existing persisent session

 * the list labeled "New" on the left side of `/attach` contains a line
   for every defined "profile." Any of these links will start a new session
   using that profile. To add a profile to get a particular workflow started,
   see [PROFILES](#profiles).

 * The "New" list always starts with a "basic" link, which starts a profile
   of the empty name.

### Existing session titles

Each existing session is shown with its title, which can be set explicitly with
the set title macro `raS T `, invoked when the terminal is open, which locks the
title to whatever text is on the current line. If the title is not set with
that macro, or if it has been unset with `laU T `, then the title is the
current line of text. If the alternative screen is open (such as with `less` or
an editor) then the last line of text printed before entering the alternate
screen is shown (for instance, `$ vim foo.txt`).

## SCROLLBACK

To access the scrollback buffer in a non-ephemeral shell, press `laH L `.
This opens a new tab and runs `less` viewing the scrollback buffer. From
there, you can close the scrollback viewer by simply closing the tab (it
is an ephemeral session). If you quit `less`, then you will return to a
shell. In this shell, the following commands and shell variables are
available:

| syntax                | description                                   |
| --------------------- | --------------------------------------------- |
| `$logfile`            | the path of the scrollback file               |
| `lel`                 | runs `less $logfile` (LEss Log)               |
| `rflt`&nbsp;`<args>`  | sends the lines in log in reverse order to `sed <args>`. For	example, `rflt '/$ grep/q; /\.h:/d'` would recall the output of	the just-run `grep` command but exclude matches found in C header files (Reverse FiLTer) |
| `rfmt`&nbsp;`<args>`  | same as `rflt`, but while `rflt` pipes output through `$PAGER`, `rfmt` uses `more` |
| `rft`&nbsp;`<args>`   | same as `rflt` but does not send to any pager |
| `dl`                  | runs `cat $logfile` (Dump Log)                |

These and other functions are defined in `$WERMSRCDIR/util/logview`

### Scrollback features

 * Open the scrollback in a new tab in an HTML `<textarea>` with macro `laH M `
   to get browser-native scrolling, searching, copying behavior. This does not
   use the alternate screen, but only the primary screen's scrollback, so you
   probably won't see editor or `less` content. This macro is defined in a tab
   with a terminal ID, but not an ephemeral terminal.

   * In the scrollback tab, to copy the selection, you may press Enter as an
     alternative to Ctrl+C followed by Ctrl+W.

 * Show the visible text only in an HTML `<textarea>` with `laH N `. This works
   with editor and UI screens, unlike `laH M `. But everything else about its
   use is the same (Enter to copy text and close the tab).

 * Scrollbacks are saved to disk in `$WERMSRCDIR/var/YEAR/MONTH/DAY`, excluding
   any content printed to the alternate screen. You can turn off the scrollback
   feature and thereby prevent the logs from being written to disk by adding the
   `sblvl=` argument to `$WERMFLAGS` (see [$WERMFLAGS](#wermflags-envvar)).
   The default value of `sblvl` is `p` which means Plain scrollback logging is
   enabled. Setting `sblvl` to `rp` (e.g. `export WERMFLAGS='sblvl=rp'`) would
   also turn on Raw logging, which saves the subprocess unified stdout/stderr
   streams (i.e. the raw bytes sent to the ptty) in files named `*.raw`.

## WERMFLAGS ENVVAR

The environment variable `$WERMFLAGS` is a URL query string without the leading
question mark, e.g. `foo=1&bar=2` or `baz=3`. This must be set when starting the
server, and the following values are supported:

| flag name   | value                                                      |
| ----------- | ---------------------------------------------------------- |
| `dtachlog=` | set to anything to enable detailed logging for the dtach component to `/tmp/dtachlog.<pid>` files |
| `sblvl=`    | see [SCROLLBACK FEATURES](#scrollback-features)            |

## PROFILES

A profile is meant to label and setup a starting state for a shell session. It
can be used to quickly accomplish a certain task or prepare to enter a certain
personalized workflow.

Profiles are divided into groups, and each *profile* has a name, an
initialization *command*, and an optional list of *Javascript* files that
the client will load, generally to just define macros, but also capable of
modifying most pertinent variables in `index.html`.

Each profile group is defined by a single file in `$WERMSRCDIR/profiles` or
`$HOME/.config/werm/profiles`. If `$WERMPROFPATH` is defined when running `run`,
the paths in *that* are searched instead. To include more than one path in
`$WERMPROFPATH`, separate separate them with a `:`.

The "group" feature is optional, meaning you may choose to put all of your
profiles in a single group. Multiple groups are useful because the `/attach`
page displays vertical space between each group. Multiple groups also allow
you to define profiles across multiple files and directories.

The profile associated with a terminal ID is the portion of the terminal ID
before the first `.`, or the entire terminal ID if there is no `.`.

Profile names may not contain the characters: `%.+=&?\/"` and space and tab.

A profile is defined by one line in its group file, and each line contains 1, 2,
or 3 fields separated by a tab. Field one is the profile name. Field two is the
preamble. Field three is the Javascript files to load with that profile, without
the `.js` extension, separated by commas. Here is an example group file:

```
profile-foo<--TAB-->source ~/.foorc<--TAB-->foo-macros1,foo-macros2,common-macros
bar-profile<--TAB-->source ~/.barrc<--TAB-->bar-macros,common-macros
basic<--TAB-->source ~/.basicrc
no-preamble<--TAB--><--TAB-->common-macros
<--TAB--># basic<--TAB-->common
```

The first two profiles have all fields defined. The third profile has no extra
JS to load, and the fourth profile has no preamble.

The fifth profile has no name. The empty-name profile is the _basic_ profile,
which always appears at the top of the New list `in /attach`. This is also the
profile used for ephemeral sessions.

### CUSTOM PROFILES: PREAMBLE

The preamble is typed automatically for you into the terminal when a new process
has been started. If the preamble is not empty, a \n is automatically typed
after it as well.

### CUSTOM PROFILES: JAVASCRIPT

JS is loaded from directories listed in `$WERMJSPATH`, which is specified in the
environment when running `$WERMSRCDIR/run`, and lists directories separated by
colons, i.e. :

If `$WERMJSPATH` is not defined, it defaults to
`$WERMSRCDIR/js:$HOME/.config/werm/js`

For instance, if the JS field of a profile is `a,b,c`, then Javascript will be
loaded from any file named `a.js`, `b.js`, or `c.js`, in any directory in
`$WERMJSPATH`. If the `.js` file is executable, it is executed and its stdout
taken. Otherwise, the files contents are taken as-is.

For a given profile, each `.js` file is concatenated together and loaded as a
single `<script>` element. To see the final `.js` file in use in a profile,
open a terminal with the profile and enter the macro `laO P J S `. This will
re-generate the `.js` file *again* and show it, rather than simply show what
was really loaded and in effect for the page. (FIXME: this is not ideal)

The Javascript generally takes the form of extra macro maps put in the map at
window.extended_macros, which look like the `macro_map` in `index.html`, e.g.:

```
$ cat foo.js
window.extended_macros.foo_macros = [
	['raD T ', 'third_party/dtach'],
	['raW S ', 'third_party/websocketd'],
];
```

```
$ cat bar.js
window.extended_macros.bar_macros = [
	...
];
```

## TERMINAL ID

When the process of a non-ephemeral terminal starts, it claims an ID of the form
`<profile_name>.<uniq_id>`. The `<profile_name>` is empty for the basic profile.
`<uniq_id>` is an ID which is designed be opaque but short and unique even among
all profiles. This ID is used in log file names, browser tab names, and `ps`
output for Werm-releated processes. The unique ID is a base 34 number matching
the regex `[a-z2-9]+` where the least significant digit is first, so typing
`.<two characters>` is enough to identify the name out of all recently spawned
terminals.

To reset the unique ID back to a single digit, delete the file that begins with
`$WERMSRCDIR/var/nextterid.` at any time.

## CAPSLOCK SIMULATION AND AUTO-OFF

If you are using a Chromebook or have mapped your physical Caps Lock to
something else, you can still get capslock functionality in Werm. This is done
with the `capsonwhile` variable, which you set in a custom macro.

`capsonwhile` should be set to a regex which is compared against each pressed
key's 2-char mnemonic. The first key that does not match will turn capslock
off. For example,

```
window.extended_macros.caps_example = [
	['raC ', function() { capsonwhile = /[A-Z0-9] /; }],
];
```

This means that `raC ` will turn on a simulated capslock until a
non-alphabetic and non-numeric key is pressed. If you want to be able to type
underscores and keep capslock on, you can keeps capslock on when shift or
the dash/underscore key is pressed. That would be the regex
`/[A-Z0-9] |ls|rs|- /`.

Alternatively, set `capsonwhile` to `/../` to turn capslock on indefinitely
(matches all keys) and set `capsonwhile` to `0` to turn it back off.

## SUGGESTED UTILITIES

These are tools unaffiliated with Werm or Google which make Werm more powerful.

### Tiling Window Manager for chromeOS

*Available on the
[Chrome Webstore](https://chromewebstore.google.com/detail/aikaaejchodabfpkipfonnekofgepakh)*

Tiles a screen into more than two windows with the keyboard. You may not need
this to only get two windows on the screen at one time.

In chromeOS without this extension, Alt+\[ and Alt+] and Meta+Alt+M are
sufficient to get two windows per monitor, on any attached monitor.

### New tab redirect

*Available on the
[Chrome webstore](https://chromewebstore.google.com/detail/icpgjfneehieebagbmdbhnlpiopdcmna)*

Opens an ephemeral terminal in a new tab (see also
`pass_ctrl_L` in `index.html` for easier access to address bar in new tabs)
