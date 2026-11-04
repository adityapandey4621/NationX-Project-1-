import { startTransition } from "react";

/**
 * Submit a server-action form without letting React 19 clear it.
 *
 * React 19 resets every field of a `<form action={fn}>` once the action finishes, so a validation error wipes
 * what the person typed (a wrong password cleared the e-mail; a missing consent tick cleared the whole help
 * request). Submitting through a transition keeps the values. Pair it with the normal `action` prop so the form
 * still works, as a plain POST, before JavaScript has loaded:
 *
 *   <form action={action} onSubmit={submitWithoutReset(action)}>
 *
 * The button that was pressed is included (a plain `new FormData(form)` leaves it out), so forms with
 * "Save draft" / "Submit" buttons that carry `name="intent"` keep working.
 */
export function submitWithoutReset(run: (formData: FormData) => void) {
  return (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const formData = new FormData(ev.currentTarget);
    const submitter = (ev.nativeEvent as SubmitEvent).submitter;
    if ((submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) && submitter.name) {
      formData.append(submitter.name, submitter.value);
    }
    startTransition(() => run(formData));
  };
}
