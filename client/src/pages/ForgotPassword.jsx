import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import logo from '../assets/logo.png'; // or logo.svg

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'otp' | 'done'
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // optional: pre-fill email from query
  useEffect(() => {
    const e = searchParams.get('email');
    if (e) setEmail(e);
  }, [searchParams]);

  // countdown for resend
  useEffect(() => {
    if (resendTimer <= 0) return;

    const id = setInterval(() => {
      setResendTimer((t) => (t > 0 ? t - 1 : 0));
    }, 1000);

    return () => clearInterval(id);
  }, [resendTimer]);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSending(true);

    try {
      const res = await api.post('/auth/request-password-reset', { email });
      setMessage(res.data.message || 'OTP sent to your email');
      setStep('otp');
      setResendTimer(30); // disable resend for 30s
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    setMessage('');
    setSending(true);

    try {
      const res = await api.post('/auth/resend-otp', { email });
      setMessage(res.data.message || 'OTP resent');
      setResendTimer(30);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resend OTP');
    } finally {
      setSending(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setVerifying(true);

    try {
      const res = await api.post('/auth/verify-otp', { email, otp });
      setMessage(res.data.message || 'OTP verified. Check your email.');
      setStep('done');

      // optional: redirect to login after a few seconds
      setTimeout(() => {
        navigate('/login');
      }, 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to verify OTP');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-background">
        {/* can reuse same decorative background as login */}
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
          <h2>{t('Forgot password')}</h2>

          {step === 'email' && (
            <form onSubmit={handleSendOtp}>
              <label className="login-label">
                {t('Registered email')}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('name@example.com')}
                  required
                />
              </label>

              {error && <div className="error">{t(error)}</div>}
              {message && <div className="info-message">{t(message)}</div>}

              <button type="submit" className="login-btn" disabled={sending}>
                {sending ? t('Sending...') : t('Send OTP')}
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp}>
              <p style={{ fontSize: 13, marginTop: 0 }}>
                {t('We sent a 6-digit OTP to')} <strong>{email}</strong>.{' '}
                {t('Enter it below to receive your reset link.')}
              </p>

              <label className="login-label">
                {t('OTP')}
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder={t('123456')}
                  maxLength={6}
                  required
                />
              </label>

              {error && <div className="error">{t(error)}</div>}
              {message && <div className="info-message">{t(message)}</div>}

              <div className="login-row">
                <button
                  type="button"
                  className="forgot-link"
                  onClick={handleResendOtp}
                  disabled={sending || resendTimer > 0}
                >
                  {resendTimer > 0
                    ? t('Resend OTP in {{seconds}}s', { seconds: resendTimer })
                    : t('Resend OTP')}
                </button>

                <button
                  type="submit"
                  className="login-btn"
                  disabled={verifying}
                  style={{ width: '140px' }}
                >
                  {verifying ? t('Verifying...') : t('Verify OTP')}
                </button>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div>
              {error && <div className="error">{t(error)}</div>}
              {message && <div className="info-message">{t(message)}</div>}
              <p style={{ fontSize: 13, marginTop: 10 }}>
                {t('You will be redirected to the login page shortly.')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}