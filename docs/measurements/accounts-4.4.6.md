# Accounts you can trust (4.4.6): reproduced, then fixed

Found by the owner on 4 November: playing as the admin on a computer and a phone, progress is not kept. Reproduced first as tests (commit `6168d11`, before any fix), run on the code of main at `34480c8`:

- `npm run test:worker`, section 29 (the real Worker under `wrangler dev`, a fresh local D1, a software passkey through the real routes);
- `npm run build && node scripts/account-verify.mjs`, scenarios E and F (a headless Chromium, iPhone 14 and Desktop Chrome sized, a virtual authenticator per device).

## Before the fix

Worker, 12 of 12 new checks fail (the 255 older ones pass):

```
FAIL owner: the admin token alone is offered the owner's account, the id the admin's rows use: null
FAIL owner: a passkey made from the token is the owner's account: 404 {"error":"Not found"}
FAIL owner: signed in on the phone with no token, the admin powers follow the account: {"ok":true,"mock":false,"admin":false,"invited":false,"email":true}
FAIL owner: what the computer and the phone found is on the account, from either device: []
FAIL owner: a token next to a session never hides the session: null put 404
FAIL owner: the First Discovery, the idea and the win from before are the account's: {"status":401}
FAIL owner: no personal cap, and a merge is paid by 'admin' as before: 401 Magic Merger is invite only. Ask the person who told you about it for your own link. paid by null
FAIL owner: once made, the token cannot make another owner passkey or mint a session: 404 404
FAIL owner: the owner's account cannot be paused, revoked or deleted: 404 404 404 self 401
FAIL owner: the account page lists both devices with their last sync: []
FAIL B on A's device: a save that belongs to A is refused by B's account, and B holds nothing of A's: 200 200 ["discoveries","island"]
FAIL island: the newer island from another device is refused with where and when, and once replaced it is kept as the previous one: {"refused":401,"forced":401,"prev":401}
```

Browser, 12 of 12 new checks fail (A to D, the 4.0 checks, pass). The two lines that are the bug itself: the phone shows 8 items after the computer found 9 (the admin's progress never reached a server), and Ben, signing in on the phone Ann had signed out of, received Ann's discovery and island on his account for good. The last line is the test stopping on the missing menu.

```
FAIL E: the admin token is offered the owner's account
FAIL E: the computer is signed in to the owner's account, admin with no token kept: {"session":false,"admin":false}
FAIL E: the phone signs in with the passkey: admin, no token, the computer's discoveries: {"admin":false,"inventory":8}
FAIL E: and the computer's island
FAIL E: "Sync now" on the computer brings what the phone found: 9 items on the computer
FAIL E: the ? menu says who is signed in and when the account was last saved
FAIL E: a newer island from the computer is offered next to the phone's, and the one not kept stays on the account: {"choice":false,"choiceText":""}
FAIL F: signing out asks to keep a copy or remove it, remove by default: {"asked":false,"focused":""}
FAIL F: B signed in on A's phone gets nothing of A's, here or on B's account: {"ann":["fire","water","earth","air","light","shadow","life","arcane","answer 1"],"ben":["fire","water","earth","air","light","shadow","life","arcane","answer 1"],"benIsland":true,"inventory":9}
FAIL F: "Switch account" back to A brings A's copy back, island included, and B's is gone: {"switched":false,"who":"Ben","inventory":0,"island":true}
FAIL F: signing out with the default leaves no trace of A on the phone: {"asked":false,"world":true,"keys":9}
FAIL page.click: Timeout 30000ms exceeded.
```

## After the fix

Worker: all 271 checks pass (two were added after the first fix: no link makes the owner's account before its passkey, and a new link signs a device in to it once it exists), section 29:

```
ok   owner: the admin token alone is offered the owner's account, the id the admin's rows use: {"id":"admin","name":"admin","signedIn":false,"claimed":false,"emailOffered":true,"admin":true}
ok   owner: no link makes the owner's account, only the token: 400
ok   owner: a passkey made from the token is the owner's account: 200 {"token":"…","name":"admin","id":"admin","admin":true,"created":true}
ok   owner: signed in on the phone with no token, the admin powers follow the account: {"ok":true,"mock":false,"admin":true,"invited":true,"account":{"id":"admin","name":"admin","signedIn":true,"claimed":true,"emailOffered":true,"admin":true},"email":true}
ok   owner: what the computer and the phone found is on the account, from either device: ["steam","mist"]
ok   owner: a token next to a session never hides the session: {"id":"admin","name":"admin","signedIn":true,"claimed":true,"emailOffered":true,"admin":true} put 200
ok   owner: the First Discovery, the idea and the win from before are the account's: {"status":200,"d":2,"i":1,"w":1}
ok   owner: no personal cap, and a merge is paid by 'admin' as before: 200  paid by admin
ok   owner: the token alone still opens the admin routes, for scripts and the nightly Action
ok   owner: once made, the token cannot make another owner passkey or mint a session: 409 404
ok   owner: once made, a new link from People signs a device in to it once (a lost passkey): 200 200
ok   owner: the owner's account cannot be paused, revoked or deleted: 400 400 400 self 400
ok   owner: the account page lists each device with its last sync, and the one signed in by the link as never synced: [{"device":"node","lastSync":1793833261155},{"device":"node","lastSync":1793833261295},{"device":"node","lastSync":null}]
ok   B on A's device: a save that belongs to A is refused by B's account, and B holds nothing of A's: 409 409 []
ok   B on A's device: B's own save, and one from a page before 4.4.6 (no owner), are kept: 200 200
ok   island: the newer island from another device is refused with where and when, and once replaced it is kept as the previous one: {"refused":409,"forced":200,"prev":{"kind":"island_previous","data":{"gz":"Q09NUDI=","size":"small","at":11},"updatedAt":1793833262609,"device":"Windows"}}
```

Browser: all 24 checks pass:

```
ok   A: the welcome closes into the one time account offer
ok   A: a passkey made the account and replaced the link on this device: {"sA":{"session":true,"invite":false,"world":false},"account":{"id":"585517b2","name":"Fay","signedIn":true,"claimed":true,"emailOffered":false,"admin":false}}
ok   A: the link stops working for anyone else: {"ok":true,"mock":false,"admin":false,"invited":false,"email":false}
ok   A: the discoveries went up, the new one among them: ["fire","water","earth","air","light","shadow","life","arcane","answer 1"]
ok   A: the island went up, packed: 71156 chars of gzip
ok   B: without a link, the gate offers a passkey sign in
ok   B: signed in, the discoveries and the island came down: {"sB":{"session":true,"invite":false,"world":true},"invB":9}
ok   B: plays as the same account
ok   B: the account page lists two devices and one passkey: {"devices":2,"passkeys":1}
ok   C: the same link opened on two devices at once makes one account: {"states":[{"session":true,"invite":false,"world":false},{"session":false,"invite":true,"world":false}],"toastsC":["",""]}
ok   D: after deletion no device is signed in and the progress is gone: {"a":false,"b":false,"progress":401}
ok   D: the admin sees the account as deleted, with its spend kept
ok   E: the admin token is offered the owner's account
ok   E: the computer is signed in to the owner's account, admin with no token kept: {"session":true,"admin":true,"account":{"id":"admin","name":"admin","signedIn":true,"claimed":true,"emailOffered":false,"admin":true}}
ok   E: the phone signs in with the passkey: admin, no token, the computer's discoveries: {"admin":true,"inventory":9}
ok   E: and the computer's island
ok   E: "Sync now" on the computer brings what the phone found: 10 items on the computer, the account holds 10: fire, water, earth, air, light, shadow, life, arcane, answer 1, answer 29
ok   E: the ? menu says who is signed in and when the account was last saved: ✨ Magic Merger Signed in as admin (the owner, with the admin powers) × Saved to your account just now, newer changes go up within a minute. Sync now Your account Switch account Sign out About the game
ok   E: a newer island from the computer is offered next to the phone's, and the one not kept stays on the account: {"choice":true,"choiceText":"🏝️ Two islands × Your island was saved from Windows NT 10.0 just now (11/4/2026, 10:50:39 PM), and this device's island","now":"iPhone","prev":["Windows NT 10.0"]}
ok   F: signing out asks to keep a copy or remove it, remove by default: {"asked":true,"focused":"card-cast signout-remove"}
ok   F: B signed in on A's phone gets nothing of A's, here or on B's account: {"ann":["fire","water","earth","air","light","shadow","life","arcane","answer 1"],"ben":["fire","water","earth","air","light","shadow","life","arcane"],"benIsland":false,"inventory":8}
ok   F: "Switch account" back to A brings A's copy back, island included, and B's is gone: {"switched":true,"who":"Ann","inventory":9,"island":true}
ok   F: signing out with the default leaves no trace of A on the phone: {"asked":true,"world":false,"keys":0}
ok   F: on a device with a link, "Sign in" is in the ? menu
```

`scripts/verify-4.1.mjs` (two tabs of one browser, review M6, and the other 4.1 browser checks) passes unchanged.

## On the live site

Deployed on 2026-11-04 at 23:03 UTC (migration 0015 applied; the live database exported first to a file outside the repository, in the session container's scratchpad: `magic-merger-live-20261104-2301-before-0015.sql`, 3.9 MB, 9064 rows, sha256 `8e157e4a…5d9179`, and the D1 Time Travel bookmark `00000190-00000006-00005119-e09dab22692c5322251f698a844413ed` taken just before). Then a scratchpad script drove the live site with a Desktop Chrome computer and an iPhone 14 phone, each with a virtual authenticator. `docs/review-4.4.6/live-log.txt` is its log, the frames are beside it.

The owner's own account was shown, not made: with the token, the computer is offered "Make the owner's account" (`02`) and the menu says "The admin, by token on this device, not signed in" (`03`); that passkey is the owner's to make on their own device. The rest of the flow ran on a stand-in, a test account flagged admin in D1 once made (no link may make an admin account), and a second test account, Ben:

1. The computer made the stand-in's passkey from its link; flagged admin, it showed the admin badge with no token kept, and the menu "Signed in as Review 4.4.6 (the owner, with the admin powers)", "Saved to your account just now" (`04`).
2. The phone, no link and no token, signed in from the gate (`05`): admin badge, Steam from the computer, the computer's island (`06`, `07`).
3. The phone made Sandstorm; "Sync now" on the computer brought it (`08`).
4. Both islands changed; "Sync now" on the phone offered both, naming the computer (`09`); the phone kept its own and the computer's stayed on the account as the previous island, listed on the account page with each device's last sync (`10`).
5. The phone signed out keeping a copy (the dialog, remove focused by default, `11`); Ben signed in on it and saw 8 items, his account holding nothing of the stand-in's and no island (`12`); "Switch account" back (removing Ben's copy) brought the stand-in's 10 items back (`13`).
6. Both test accounts were then unflagged, revoked and deleted from the People routes: no passkey, session or progress row left, $0 spent; the owner's row is untouched (unclaimed, no passkey, no session).

A first run of the same script failed at step 5: the script had put back the stand-in's passkey as it was before the phone used it, so its signature counter repeated and the Worker refused it as a cloned authenticator (4.1). The second run carries the phone's own copy, as a real phone does; both runs' test accounts are deleted.
