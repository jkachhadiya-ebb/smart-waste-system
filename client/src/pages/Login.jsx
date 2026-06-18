import { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { AuthContext } from '../context/AuthContext.jsx';
import logo from '../assets/logo.png';

export default function Login() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleForgotPassword = () => {
    navigate('/forgot-password');
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('rememberCredentials');
      if (!saved) return;
      const { username, password } = JSON.parse(saved);
      setUsername(username || '');
      setPassword(password || '');
      setRememberMe(true);
    } catch (err) {
      console.warn('Failed to read saved credentials', err);
      try {
        localStorage.removeItem('rememberCredentials');
      } catch (removeErr) {
        console.warn('Failed to clear saved credentials', removeErr);
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login', { username, password });
      if (res.data?.mfaRequired) {
        setMfaRequired(true);
        setMfaToken(res.data.mfaToken || '');
        setMfaCode('');
        return;
      }

      login(res.data.token, res.data.username);

      try {
        if (rememberMe) {
          localStorage.setItem(
            'rememberCredentials',
            JSON.stringify({ username, password })
          );
        } else {
          localStorage.removeItem('rememberCredentials');
        }
      } catch (storageErr) {
        console.warn('Failed to update saved credentials', storageErr);
      }

      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post('/auth/login/2fa', { token: mfaToken, code: mfaCode });
      login(res.data.token, res.data.username);

      try {
        if (rememberMe) {
          localStorage.setItem(
            'rememberCredentials',
            JSON.stringify({ username, password })
          );
        } else {
          localStorage.removeItem('rememberCredentials');
        }
      } catch (storageErr) {
        console.warn('Failed to update saved credentials', storageErr);
      }

      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Two-factor verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Background decorative layer */}
      <div className="login-background">
        <div className="bg-circle bg-circle-1" />
        <div className="bg-circle bg-circle-2" />
        <div className="bg-circle bg-circle-3" />
        <div className="bg-icon bg-truck">🚛</div>
        <div className="bg-icon bg-bin">🗑️</div>
        <div className="bg-icon bg-leaf">🌿</div>
      </div>

      <div className="login-wrapper">
        <div className="login-logo-block">
          <img src={logo} alt={t('Smart Waste Logo')} className="login-logo-image" />
        </div>

        <div className="login-card">
          <h2>{t('Login')}</h2>

          <form onSubmit={mfaRequired ? handleMfaSubmit : handleSubmit}>
            {!mfaRequired ? (
              <>
                <label className="login-label">
                  {t('Username or email')}
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('Username or email')}
                  />
                </label>

                <label className="login-label">
                  {t('Password')}
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('Password')}
                    />
                </label>

                <div className="login-row">
                  <label className="remember-me">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    {t('Remember me')}
                  </label>

                  <button
                    type="button"
                    className="forgot-link"
                    onClick={handleForgotPassword}
                  >
                    {t('Forgot password?')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="info-message">
                  {t('Enter the 6-digit code from your authenticator app.')}
                </p>
                <label className="login-label">
                  {t('Authentication code')}
                  <input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder={t('123456')}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
                <div className="login-row">
                  <span />
                  <button
                    type="button"
                    className="forgot-link"
                    onClick={() => {
                      setMfaRequired(false);
                      setMfaToken('');
                      setMfaCode('');
                      setError('');
                    }}
                  >
                    {t('Back to login')}
                  </button>
                </div>
              </>
            )}

            {error && <div className="error">{t(error)}</div>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? t('Logging in...') : mfaRequired ? t('Verify code') : t('Log in')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
