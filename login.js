const form = document.getElementById('loginForm');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const registerFields = document.getElementById('registerFields');
const error = document.getElementById('authError');
const password = document.getElementById('password');
let registering = false;

function setMode(register) {
  registering = register;
  registerFields.hidden = !register;
  form.elements.name.required = register;
  password.minLength = register ? 8 : 0;
  password.autocomplete = register ? 'new-password' : 'current-password';
  loginTab.classList.toggle('active', !register);
  registerTab.classList.toggle('active', register);
  loginTab.setAttribute('aria-pressed', String(!register));
  registerTab.setAttribute('aria-pressed', String(register));
  document.getElementById('authTitle').textContent = register ? 'Create your account.' : 'Good to have you back.';
  document.getElementById('authDescription').textContent = register ? 'Join as a guest or property owner.' : 'Log in to save stays, send enquiries and manage listings.';
  document.getElementById('submitAuth').textContent = register ? 'Create account →' : 'Log in →';
  document.title = `${register ? 'Create account' : 'Log in'} — Hostel Homes`;
  error.hidden = true;
}
loginTab.addEventListener('click', () => setMode(false));
registerTab.addEventListener('click', () => setMode(true));
form.addEventListener('submit', async event => {
  event.preventDefault();
  error.hidden = true;
  const data = new FormData(form);
  const body = { email: data.get('email'), password: data.get('password') };
  if (registering) { body.name = data.get('name'); body.role = data.get('role'); }
  const submit = document.getElementById('submitAuth');
  submit.disabled = true;
  try {
    const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Unable to continue. Please try again.');
    localStorage.setItem('hh_session', JSON.stringify(result));
    window.location.assign('/');
  } catch (err) {
    error.textContent = err.message || 'Could not connect. Please try again.';
    error.hidden = false;
    submit.disabled = false;
  }
});
setMode(new URLSearchParams(window.location.search).get('mode') === 'register');
