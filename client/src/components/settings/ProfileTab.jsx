import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useDirtyGuard from '../../hooks/useDirtyGuard';
import LeafletPinPicker from './LeafletPinPicker.jsx';
import {
  fetchProfile,
  uploadProfileLogo,
  updateProfile,
} from '../../api/settingsApi.js';
import { subscribeToSettings } from '../../socket/settingsSocket.js';

const DEFAULT_MAP_POSITION = { lat: 50.39, lng: 7.59 };

function sanitizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildFormFromMunicipality(municipality) {
  return {
    address_text: municipality?.address_text ?? '',
    address_lat: sanitizeNumber(municipality?.address_lat),
    address_lng: sanitizeNumber(municipality?.address_lng),
    contact_email: municipality?.contact_email ?? '',
    contact_phone: municipality?.contact_phone ?? '',
    logo_url: municipality?.logo_url ?? '',
  };
}

export default function ProfileTab({ forceRefreshKey, onDirtyChange }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [error, setError] = useState('');
  const [municipality, setMunicipality] = useState(null);
  const [form, setForm] = useState(buildFormFromMunicipality(null));
  const [savedForm, setSavedForm] = useState(null);
  const [isEditingContact, setIsEditingContact] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await fetchProfile();
      setMunicipality(data.municipality);
      const nextForm = buildFormFromMunicipality(data.municipality);
      setForm(nextForm);
      setSavedForm(nextForm);
      setIsEditingContact(false);
    } catch (err) {
      console.error('Profile load', err);
      setError(err.response?.data?.message || 'Unable to load municipality info.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [forceRefreshKey, loadProfile]);

  const isDirty = useMemo(() => {
    if (!savedForm) return false;
    return JSON.stringify(form) !== JSON.stringify(savedForm);
  }, [form, savedForm]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useDirtyGuard(isDirty);

  useEffect(() => {
    const unsubscribe = subscribeToSettings('municipalitySettingsUpdated', (payload) => {
      if (!payload || payload.municipality_id !== municipality?.id) return;
      if (isDirty) {
        toast(t('Municipality profile changed elsewhere; refresh to sync.'));
        return;
      }
      loadProfile();
    });
    return unsubscribe;
  }, [isDirty, loadProfile, municipality?.id]);

  const handleInputChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleMarkerChange = (pos) => {
    setForm((prev) => ({
      ...prev,
      address_lat: sanitizeNumber(pos.lat),
      address_lng: sanitizeNumber(pos.lng),
    }));
  };

  const handleLogoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const { data } = await uploadProfileLogo(file);
      setForm((prev) => ({ ...prev, logo_url: data.url }));
      toast.success(t('Logo uploaded. Save the profile to persist the new URL.'));
    } catch (err) {
      console.error('Logo upload', err);
      toast.error(t('Logo upload failed.'));
    } finally {
      setLogoUploading(false);
      event.target.value = '';
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        address_text: form.address_text || null,
        address_lat: form.address_lat ?? null,
        address_lng: form.address_lng ?? null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        logo_url: form.logo_url || null,
      };
      const { data } = await updateProfile(payload);
      setMunicipality(data.municipality);
      const nextForm = buildFormFromMunicipality(data.municipality);
      setForm(nextForm);
      setSavedForm(nextForm);
      setIsEditingContact(false);
      toast.success(t('Municipality information saved'));
    } catch (err) {
      console.error('Profile save', err);
      toast.error(t(err.response?.data?.message || 'Could not save municipality info'));
    } finally {
      setSaving(false);
    }
  };

  const handleEditToggle = () => {
    if (isEditingContact) {
      if (savedForm) {
        setForm(savedForm);
      }
      setIsEditingContact(false);
      return;
    }
    if (municipality) {
      setForm(buildFormFromMunicipality(municipality));
    }
    setIsEditingContact(true);
  };

  const displayContact = savedForm || buildFormFromMunicipality(municipality);

  const mapPosition =
    form.address_lat !== null && form.address_lng !== null
      ? { lat: form.address_lat, lng: form.address_lng }
      : municipality?.address_lat && municipality?.address_lng
      ? { lat: Number(municipality.address_lat), lng: Number(municipality.address_lng) }
      : DEFAULT_MAP_POSITION;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-48 rounded-xl bg-slate-200 animate-pulse" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-28 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-28 rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-600">{t(error)}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel">
          <h3 className="text-lg font-semibold text-slate-700">{t('Municipality details')}</h3>
          <dl className="mt-4 grid gap-3 text-sm text-slate-600">
            <div className="border-b border-slate-100 pb-2">
              <dt className="text-xs uppercase tracking-wider text-slate-400">{t('Name')}</dt>
              <dd className="text-base font-semibold text-slate-800">{municipality?.name || t('Unknown')}</dd>
            </div>
            <div className="border-b border-slate-100 pb-2">
              <dt className="text-xs uppercase tracking-wider text-slate-400">{t('Municipality code')}</dt>
              <dd className="font-semibold text-slate-800">{municipality?.municipality_code || t('Unknown')}</dd>
            </div>
            <div className="grid gap-1 border-b border-slate-100 pb-2">
              <dt className="text-xs uppercase tracking-wider text-slate-400">{t('Country')}</dt>
              <dd>{municipality?.country || t('Unknown')}</dd>
            </div>
            <div className="grid gap-1 border-b border-slate-100 pb-2">
              <dt className="text-xs uppercase tracking-wider text-slate-400">{t('State / Region')}</dt>
              <dd>{municipality?.state_region || t('N/A')}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs uppercase tracking-wider text-slate-400">{t('City')}</dt>
              <dd>{municipality?.city || t('N/A')}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-700">{t('Contact details')}</h3>
          <p className="text-sm text-slate-500">
            {t('Coordinate changes are reflected live on the dashboard map; drag the pin to update the location.')}
          </p>
          <div className="flex flex-col gap-3">
            {isEditingContact ? (
              <>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400">{t('Address')}</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-sky-500 focus:outline-none"
                    value={form.address_text}
                    onChange={(event) => handleInputChange('address_text', event.target.value)}
                    placeholder={t('Street, number, postal code')}
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400">{t('Email')}</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-sky-500 focus:outline-none"
                    value={form.contact_email}
                    onChange={(event) => handleInputChange('contact_email', event.target.value)}
                    placeholder={t('contact@example.com')}
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-slate-400">{t('Phone')}</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-sky-500 focus:outline-none"
                    value={form.contact_phone}
                    onChange={(event) => handleInputChange('contact_phone', event.target.value)}
                    placeholder={t('+49 123 456 789')}
                  />
                </div>
              </>
            ) : (
              <dl className="grid gap-3 text-sm text-slate-600">
                <div className="border-b border-slate-100 pb-2">
                  <dt className="text-xs uppercase tracking-wider text-slate-400">{t('Address')}</dt>
                  <dd className="text-base font-semibold text-slate-800">
                    {displayContact.address_text || t('Not set')}
                  </dd>
                </div>
                <div className="border-b border-slate-100 pb-2">
                  <dt className="text-xs uppercase tracking-wider text-slate-400">{t('Email')}</dt>
                  <dd>{displayContact.contact_email || t('Not set')}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs uppercase tracking-wider text-slate-400">{t('Phone')}</dt>
                  <dd>{displayContact.contact_phone || t('Not set')}</dd>
                </div>
              </dl>
            )}
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-400">{t('Logo / Icon')}</label>
              <div className="mt-1 flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {form.logo_url ? (
                    <img src={form.logo_url} alt={t('Logo preview')} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                      {t('No logo')}
                    </div>
                  )}
                </div>
                <label
                  className={`btn-secondary rounded-xl px-3 py-2 ${isEditingContact ? '' : 'opacity-60 cursor-not-allowed'}`}
                >
                  <input
                    type="file"
                    accept="image/*"
                    disabled={logoUploading || !isEditingContact}
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  {logoUploading ? t('Uploading...') : t('Upload logo')}
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">{t('Address map pin')}</h3>
            <p className="text-sm text-slate-500">
              {t('Drag the marker to align the dashboard map marker with the address.')}
            </p>
          </div>
        </div>
        <LeafletPinPicker
          position={mapPosition}
          onChange={(pos) => handleMarkerChange(pos)}
          editable={isEditingContact}
          height={280}
          markerIconUrl={form.logo_url}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {isEditingContact && (
          <button
            type="button"
            className="btn-primary px-6 py-2"
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            {saving ? t('Saving...') : t('Save profile')}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary px-4 py-2"
          onClick={handleEditToggle}
        >
          {isEditingContact ? t('Cancel') : t('Edit')}
        </button>
      </div>
    </div>
  );
}
