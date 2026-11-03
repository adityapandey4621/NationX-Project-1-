/**
 * Maps Supabase Auth / database errors to messages that are safe and useful to
 * show end users. Sign-in failures are deliberately uniform so the response
 * does not reveal whether an email is registered.
 */

interface AuthLikeError {
  code?: string;
  message?: string;
  status?: number;
}

export function describeSignInError(error: AuthLikeError): string {
  if (error.code === "email_not_confirmed") {
    return "Please confirm your email address first. Check your inbox for the confirmation link.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (error.code === "invalid_credentials" || error.status === 400) {
    return "Invalid email or password.";
  }
  return "We couldn't sign you in right now. Please try again.";
}

export function describeSignUpError(error: AuthLikeError): string {
  const message = error.message?.toLowerCase() ?? "";
  if (error.code === "user_already_exists" || error.code === "email_exists") {
    return "An account with this email already exists. Try signing in instead.";
  }
  // Our profile trigger enforces a unique phone number; GoTrue surfaces trigger
  // failures as "Database error saving new user".
  if (error.code === "unexpected_failure" || message.includes("database error saving new user")) {
    return "We couldn't create your account. This phone number or email may already be registered.";
  }
  if (error.code === "weak_password") {
    return "That password is too weak. Use at least 8 characters.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  return "We couldn't create your account right now. Please try again.";
}
