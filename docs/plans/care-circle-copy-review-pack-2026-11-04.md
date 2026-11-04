# Care Circle wording review pack, 2026-11-04

**263 strings in 6 groups.**

**Approved as written by the founder acting as CMO and DPO, in chat, 2026-11-04.** Any later change to one of these strings needs a fresh review.

Rules every string already passes by test: no em dashes, never "doctor-led", never "your doctor" (a care team, not one named doctor), no WhatsApp, no condition, reading or medicine named, and nothing in a notification carries health details.

## Sharing with the person who paid, and payer invitations (giftshare.) (21)

| Key | Text |
|---|---|
| `giftshare.title` | Would you like {name} to see how you are doing? |
| `giftshare.intro` | {name} paid for your care. You can let them see a little of how you are doing. Nothing is shared until you choose, and you can change or stop it at any time. |
| `giftshare.someone` | the person who paid |
| `giftshare.legend` | Choose what they can see |
| `giftshare.monthly` | My monthly report |
| `giftshare.usual` | Share the usual |
| `giftshare.usual_hint` | The usual is: your weekly blood pressure trend, doses taken, appointments, a message asking them to check on you if you need help, and your monthly report. |
| `giftshare.share` | Share what I ticked |
| `giftshare.not_now` | Not now |
| `giftshare.nothing_ticked` | Tick at least one thing, or choose Not now. |
| `giftshare.saving` | Saving |
| `giftshare.done` | Done. We have asked {name} to join your Care Circle. They see nothing until they say yes, and you can change or stop this any time. |
| `giftshare.waiting` | Waiting for {name} to say yes. |
| `giftshare.done_member` | Done. {name} can now see what you chose. You can change or stop this any time in your Care Circle. |
| `giftshare.not_now_done` | Nothing was shared, and we will not ask again. You can still invite them to your Care Circle at any time. |
| `giftshare.error` | That could not be saved, so nothing was shared. Please try again. |
| `giftshare.error_full` | Your Care Circle is full. Remove someone first, then try again. |
| `giftshare.later_title` | People who paid for your care |
| `giftshare.later_body` | They see nothing about your health unless you choose. |
| `giftshare.later_open` | Choose what {name} can see |
| `giftshare.loading` | Loading the people who paid for your care |

## The doctor's note for the family (familynote.) (32)

| Key | Text |
|---|---|
| `familynote.perm` | A short line from the doctor for my family after a consultation, once I have read it and chosen to share it (never results, diagnoses or medicine names) |
| `familynote.view.title` | A note from the doctor |
| `familynote.view.none` | No note yet. After a consultation, the doctor may write a short line for the family. |
| `familynote.view.from` | From {name} |
| `familynote.view.from_team` | From your care team |
| `familynote.view.written` | Written {date} |
| `familynote.mine.title` | A note from the doctor for your family |
| `familynote.mine.intro` | After your consultation, the doctor wrote this short line for the people who support you. Nobody else sees it unless you choose to share it. |
| `familynote.mine.private` | Only you can see this |
| `familynote.mine.shared` | Shared with your Care Circle |
| `familynote.mine.who` | If you share it, only the people you have allowed to see a line from the doctor will read it. You can stop sharing at any time. |
| `familynote.mine.share` | Share with my Care Circle |
| `familynote.mine.dont_share` | Don't share |
| `familynote.mine.stop` | Stop sharing |
| `familynote.mine.earlier` | An earlier note your Care Circle can still see |
| `familynote.mine.shared_done` | Shared. People you allowed to see a line from the doctor can now read it. |
| `familynote.mine.unshared_done` | Not shared. Only you can see it. |
| `familynote.mine.error` | That could not be saved. Nothing changed. Please try again. |
| `familynote.mine.loading` | Loading the note from the doctor |
| `familynote.form.title` | A line for the family |
| `familynote.form.optional` | Optional |
| `familynote.form.label` | Write one short line the family can read |
| `familynote.form.hint` | Plain words. No results, diagnoses or medicine names. |
| `familynote.form.who` | The patient reads it first. Their family sees it only if the patient chooses to share it, and only the latest shared line. |
| `familynote.form.count` | {used} of {max} characters |
| `familynote.form.save` | Save the line |
| `familynote.form.saving` | Saving |
| `familynote.form.saved` | Saved. The patient will see it first and can choose to share it with their family. |
| `familynote.form.empty` | Write something first, or leave this blank. |
| `familynote.form.too_long` | Keep it to {max} characters. |
| `familynote.form.not_allowed` | Only the doctor who held this consultation can write this, once it has finished. |
| `familynote.form.error` | That could not be saved. Please try again. |

## Phase 1: help alert while paused, payer accept/decline, sharing history (circlep1.) (36)

| Key | Text |
|---|---|
| `circlep1.help.paused_warning` | Your Care Circle is paused. If you press this, it will still reach the people who can receive alerts. |
| `circlep1.help.sent_paused` | Your circle is paused, but this alert was still sent. |
| `circlep1.offer.title` | {name} has asked you to join their Care Circle |
| `circlep1.offer.body` | You paid for their care, and they would like you to see a little of how they are doing. Nothing is shown to you until you say yes, and they can change or stop it at any time. |
| `circlep1.offer.answer_by` | Please answer by {date}. |
| `circlep1.offer.accept` | Yes, join |
| `circlep1.offer.decline` | No, thank you |
| `circlep1.offer.accepted` | You have joined {name}'s Care Circle. |
| `circlep1.offer.declined` | You said no. Nothing will be shared with you. |
| `circlep1.offer.error` | That did not work. Please try again. |
| `circlep1.offers.title` | Waiting for a reply |
| `circlep1.offers.row` | {name}, until {date} |
| `circlep1.offers.withdraw` | Withdraw |
| `circlep1.history.title` | Changes to sharing |
| `circlep1.history.empty` | No changes yet. |
| `circlep1.history.error` | We could not load this just now. |
| `circlep1.history.added` | {name} joined your Care Circle |
| `circlep1.history.offered` | You asked {name} to join |
| `circlep1.history.accepted` | {name} said yes |
| `circlep1.history.declined` | {name} said no |
| `circlep1.history.withdrawn` | You withdrew the invitation to {name} |
| `circlep1.history.offer_lapsed` | {name} did not answer in time |
| `circlep1.history.permissions_changed` | What {name} can see was changed |
| `circlep1.history.renewed` | {name}'s access was extended |
| `circlep1.history.revoked` | {name} was removed |
| `circlep1.history.left` | {name} left your Care Circle |
| `circlep1.history.expired` | {name}'s access ended |
| `circlep1.history.monthly_report_on` | {name} can see your monthly summary |
| `circlep1.history.monthly_report_off` | {name} no longer sees your monthly summary |
| `circlep1.history.missed_dose_alert_on` | {name} will be nudged about missed doses |
| `circlep1.history.missed_dose_alert_off` | {name} will no longer be nudged about missed doses |
| `circlep1.history.paused` | You paused sharing |
| `circlep1.history.resumed` | Sharing started again |
| `circlep1.history.doctor_note_shared` | You shared a doctor's note with your circle |
| `circlep1.history.doctor_note_withdrawn` | You stopped sharing a doctor's note |
| `circlep1.history.someone` | A supporter |

## Phase 2: tests, results, weight, yearly check-ups, person switcher (circlep2.) (33)

| Key | Text |
|---|---|
| `circlep2.perm.investigation_status` | Where my tests have got to (no results) |
| `circlep2.perm.investigation_values` | My test results, once a doctor has reviewed them |
| `circlep2.perm.weekly_weight_trend` | My weight, as a weekly average |
| `circlep2.perm.care_plan_progress` | How my yearly check-ups are going |
| `circlep2.tests.title` | Tests |
| `circlep2.tests.none` | No tests in their plan just now. |
| `circlep2.tests.follow_up` | Their care team has asked for a follow-up on this one. |
| `circlep2.tests.due_on` | Due {date} |
| `circlep2.stage.due` | Due |
| `circlep2.stage.overdue` | Overdue |
| `circlep2.stage.requested` | Requested |
| `circlep2.stage.awaiting_result` | Waiting for the result |
| `circlep2.stage.result_received` | Result received, waiting for a doctor to look at it |
| `circlep2.stage.awaiting_review` | Waiting for a doctor to review |
| `circlep2.stage.reviewed` | Reviewed by a doctor |
| `circlep2.stage.done` | Done |
| `circlep2.results.title` | Test results a doctor has reviewed |
| `circlep2.results.none` | No reviewed results in the last year. |
| `circlep2.results.in_range` | Within the lab's usual range |
| `circlep2.results.out_range` | Outside the lab's usual range |
| `circlep2.results.ask` | Ask {name} or their care team what these results mean for them. |
| `circlep2.results.on` | Reviewed {date} |
| `circlep2.weight.title` | Weight, as a weekly average |
| `circlep2.weight.none` | No weight readings recorded recently. |
| `circlep2.weight.row` | Week of {date}: {kg} kg |
| `circlep2.weight.higher` | Higher than a few weeks ago |
| `circlep2.weight.lower` | Lower than a few weeks ago |
| `circlep2.weight.steady` | About the same as a few weeks ago |
| `circlep2.plan.title` | Yearly check-ups |
| `circlep2.plan.none` | No check-ups in their plan yet. |
| `circlep2.plan.line` | {done} done, {due} still to do, {overdue} overdue |
| `circlep2.plan.next` | Next one due {date} |
| `circlep2.switcher.label` | Whose care to show |

## Shared jobs and help requests (cctools.) (88)

| Key | Text |
|---|---|
| `cctools.preset.legend` | What can this person do? |
| `cctools.preset.see.title` | Can see |
| `cctools.preset.see.body` | They can see how things are going and be asked to check on you. They cannot pay or take on jobs. |
| `cctools.preset.help.title` | Can see and help |
| `cctools.preset.help.body` | Everything in Can see, and they can also pay for your care and take on small jobs you share, like a lift to the lab. |
| `cctools.preset.custom.title` | Choose one by one |
| `cctools.preset.custom.body` | Tick exactly what you want below. |
| `cctools.preview.title.sender` | What this person will see and do |
| `cctools.preview.title.invitee` | What you will be able to see and do |
| `cctools.preview.sees` | They will see |
| `cctools.preview.sees.invitee` | You will see |
| `cctools.preview.can` | They will be able to |
| `cctools.preview.can.invitee` | You will be able to |
| `cctools.preview.sees.adherence` | Whether medicines were taken, as a count for the week. Never which medicines. |
| `cctools.preview.sees.bp` | A weekly blood pressure trend, as averages only. Never a single reading. |
| `cctools.preview.sees.appointments` | The next appointment, and whether any were missed. Never the reason. |
| `cctools.preview.sees.digest` | A short weekly note, for example how many days readings were logged. |
| `cctools.preview.sees.doctor_note` | A short line from the doctor for the family after a consultation, only once you have read it and chosen to share it. Never results, diagnoses or medicine names. |
| `cctools.preview.can.alert` | Be asked to check in when your care team sees something urgent. They see only a name, never what happened. |
| `cctools.preview.can.pay` | Pay for care. Paying shows no health information. |
| `cctools.preview.can.tasks` | Take on small shared jobs, like a lift to the lab or collecting medicines. |
| `cctools.preview.can.call` | Be invited to join a call, one call at a time. |
| `cctools.preview.never` | Never shared: single readings, medicine names, results, notes or messages. |
| `cctools.preview.control.sender` | You can stop sharing at any time, and you can always see who looked. |
| `cctools.preview.control.invitee` | {name} can stop sharing at any time, and can see each time you look. |
| `cctools.preview.none` | Nothing is shared yet. Choose what they can do. |
| `cctools.preview.cross_org` | Because your account is with a different organisation, some options are not available to you. |
| `cctools.invite.waiting` | Waiting for them |
| `cctools.invite.waiting_help` | Their name appears here when they join. The link works until {date}. |
| `cctools.join.not_now` | Not now |
| `cctools.join.not_now_done` | Okay. Nothing has been shared with you. Ask for a new link any time. |
| `cctools.join.not_now_error` | We could not do that just now. Please try again. |
| `cctools.nudge.label` | Send {name} a gentle nudge if a dose has had no answer for a while |
| `cctools.nudge.help` | After about {minutes} minutes with no answer, {name} gets a short note that says nothing about medicines. It is never used for an urgent event, which reaches your circle straight away. |
| `cctools.nudge.needs_adherence` | Share the medicines count with {name} first to use this. |
| `cctools.nudge.error` | We could not save that. Please try again. |
| `cctools.nudges.title` | A friendly call may help |
| `cctools.nudges.line` | {name} may like to hear from you. |
| `cctools.digest.title` | This week |
| `cctools.digest.note` | A short note built only from what {name} chose to share. |
| `cctools.digest.doses` | {name} took all their medicines on {done} of {total} days. |
| `cctools.digest.readings` | {name} logged readings on {days} of {span} days. |
| `cctools.digest.next_appointment` | Next appointment: {date} |
| `cctools.digest.tasks` | Shared jobs: {open} to claim, {claimed} taken on, {done} done. |
| `cctools.digest.empty` | Nothing to show this week. |
| `cctools.tasks.title` | Shared jobs |
| `cctools.tasks.intro` | Small jobs the circle can take on. There is no chat here and nothing is typed in. |
| `cctools.tasks.empty` | No jobs right now. |
| `cctools.tasks.view_only` | You can see these jobs. Taking one on needs the Can see and help setting. |
| `cctools.tasks.add` | Add a job |
| `cctools.tasks.kind` | What is it? |
| `cctools.tasks.date` | Needed by (optional) |
| `cctools.tasks.post` | Add job |
| `cctools.tasks.claim` | I will do this |
| `cctools.tasks.release` | I cannot do it now |
| `cctools.tasks.complete` | Mark done |
| `cctools.tasks.cancel` | Remove |
| `cctools.tasks.state.open` | Open |
| `cctools.tasks.state.claimed_other` | {name} will do this |
| `cctools.tasks.state.claimed_mine` | You will do this |
| `cctools.tasks.state.done` | Done |
| `cctools.tasks.needed_by` | Needed by {date} |
| `cctools.tasks.taken` | Someone already took this one. |
| `cctools.tasks.limit` | There are already as many open jobs as allowed. Finish or remove one first. |
| `cctools.tasks.error` | We could not do that just now. Please try again. |
| `cctools.task.kind.take_to_appointment` | A lift to an appointment |
| `cctools.task.kind.take_to_lab` | A lift to the lab |
| `cctools.task.kind.collect_medicines` | Collect medicines |
| `cctools.task.kind.visit` | A visit |
| `cctools.task.kind.phone_call` | A phone call |
| `cctools.task.kind.errand` | An errand |
| `cctools.task.kind.transport` | Help with transport |
| `cctools.task.kind.help_paying_test` | Help paying for a test |
| `cctools.task.kind.help_paying_medicines` | Help paying for medicines |
| `cctools.task.kind.consultation_help` | Help with a consultation |
| `cctools.task.kind.other` | Something else |
| `cctools.tasks.who` | Who is this for? |
| `cctools.tasks.who_everyone` | Everyone who helps |
| `cctools.tasks.who_hint` | Only the people you tick will see this request. |
| `cctools.tasks.note` | A short note (optional) |
| `cctools.tasks.note_hint` | Plain words, at most 140 characters. Please do not write medical details here. |
| `cctools.tasks.note_needed` | Please add a short note to say what you need. |
| `cctools.tasks.for_you` | Asked of you |
| `cctools.tasks.decline` | I can't help |
| `cctools.tasks.declined_mine` | You said you can't help with this. |
| `cctools.tasks.answer.can_help` | {name} can help |
| `cctools.tasks.answer.cannot_help` | {name} can't help |
| `cctools.tasks.answer.waiting` | {name} has not answered yet |

## Family member join path (supporterjoin.) (53)

| Key | Text |
|---|---|
| `supporterjoin.share_text` | I would like you to join my Care Circle on Tarragon Health, so you can follow how I am doing. First create a free supporter account using the same email address or phone number I sent this to. Then tap this link to accept: {link} |
| `supporterjoin.list_heading` | What you will be able to see and do |
| `supporterjoin.sees.adherence` | See whether {name} took their medicines this week, as a simple count. Never which medicines. |
| `supporterjoin.sees.bp` | See {name}'s weekly blood pressure trend, as averages only. Never a single reading. |
| `supporterjoin.sees.appointments` | See {name}'s next appointment, and whether one was missed. Never the reason. |
| `supporterjoin.sees.digest` | Get a short weekly note on how {name} is getting on, such as how many days they logged a reading. |
| `supporterjoin.sees.doctor_note` | See a short note from {name}'s doctor after a meeting, only when {name} chooses to share it. |
| `supporterjoin.can.alert` | Be asked to check on {name} if their care team sees something urgent. You will see only that they need a call, never what happened. |
| `supporterjoin.can.pay` | Pay for {name}'s care. Paying shows you no health information. |
| `supporterjoin.can.tasks` | Help with small jobs {name} asks for, like a lift to the lab or collecting medicines. |
| `supporterjoin.can.call` | Join a video visit when {name} invites you, one visit at a time. |
| `supporterjoin.never` | {name} never shares single readings, medicine names, results, notes or messages through the Care Circle. |
| `supporterjoin.control` | {name} chose this, can change it at any time, and can see each time you look. |
| `supporterjoin.landing.title` | {name} invited you to their Care Circle |
| `supporterjoin.landing.lead` | A Care Circle is how {name} keeps the people close to them in the loop, wherever they live. |
| `supporterjoin.landing.free` | Joining is free. You will have a supporter account, so we will not ask you any health questions. |
| `supporterjoin.landing.contact_email` | This invite was sent to {hint}. Use that email address to create your account or to sign in. |
| `supporterjoin.landing.contact_phone` | This invite was sent to {hint}. Use that phone number to create your account or to sign in. |
| `supporterjoin.landing.create` | Create a free supporter account |
| `supporterjoin.landing.sign_in` | I already have an account |
| `supporterjoin.landing.after` | After you sign in, you come straight back here to accept. |
| `supporterjoin.landing.invalid_title` | This invite link has stopped working |
| `supporterjoin.landing.invalid` | Invite links stop working when they expire, once they have been used, or when a newer one is sent. Ask the person who invited you to send a fresh link from their app. |
| `supporterjoin.landing.busy` | There have been a lot of tries from this connection. Please wait a few minutes, then open the link again. |
| `supporterjoin.join.title` | {name} invited you to their Care Circle |
| `supporterjoin.join.relationship` | They added you as: {relationship} |
| `supporterjoin.join.checking` | Checking your invite |
| `supporterjoin.join.done_title` | You are in {name}'s Care Circle |
| `supporterjoin.join.done` | You can now see what {name} chose to share, and you will be told at once if they ask for help. |
| `supporterjoin.join.open` | Go to {name}'s page |
| `supporterjoin.error.wrong_contact_email` | This invite was sent to {hint}, which is not the email address on the account you are signed in with. Sign in with that email address, or ask for a new invite to this account. |
| `supporterjoin.error.wrong_contact_phone` | This invite was sent to {hint}, which is not the phone number on the account you are signed in with. Sign in with that phone number, or ask for a new invite to this account. |
| `supporterjoin.error.expired` | This invite has expired. Ask the person who invited you to send a new link from their app. It only takes them a moment. |
| `supporterjoin.error.no_longer_valid` | This invite link is no longer valid. It may have been used already, or replaced by a newer one. Ask the person who invited you to send a fresh link. |
| `supporterjoin.error.already_member` | You are already in this Care Circle, so there is nothing more to do. |
| `supporterjoin.error.own_invite` | This is an invite you made. Send the link to the person you would like to invite. |
| `supporterjoin.error.needs_supporter` | This invite can only be accepted with a supporter account. Create a free supporter account using the email address or phone number the invite was sent to. |
| `supporterjoin.error.not_available` | We could not open this invite just now. Please try again in a moment. |
| `supporterjoin.error.switch_account` | Sign in with a different account |
| `supporterjoin.error.open_people` | Go to People you support |
| `supporterjoin.view.title` | {name}'s care |
| `supporterjoin.view.shared_heading` | What {name} shares with you |
| `supporterjoin.view.empty` | {name} has not shared anything to show here yet. |
| `supporterjoin.view.empty_alerts` | You will still be told at once if they need help. |
| `supporterjoin.view.empty_pay` | You can still pay for their care from this page. |
| `supporterjoin.view.nothing_now` | Nothing is being shared with you right now. |
| `supporterjoin.view.nothing_now_body` | When someone shares their care with you, you will find them in People you support. |
| `supporterjoin.view.loading` | Loading |
| `supporterjoin.view.retry` | Try again |
| `supporterjoin.view.load_failed` | We could not load this page just now. Check your connection and try again. |
| `supporterjoin.mode.label` | Choose what to look at |
| `supporterjoin.mode.mine` | My health |
| `supporterjoin.mode.supporting` | People I support |
