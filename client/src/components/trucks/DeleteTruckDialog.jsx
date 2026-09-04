import { useTranslation } from 'react-i18next';

export default function DeleteTruckDialog({ isOpen, truck, onCancel, onConfirm, deleting }) {
  const { t } = useTranslation();
  if (!isOpen || !truck) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{t('Delete truck')}</h2>
        <div className="modal-body">
          <p>
            {t('Are you sure you want to delete truck {{code}}?', {
              code: truck.truck_code || truck.id,
            })}
          </p>
          <div className="hint">{t('This action cannot be undone.')}</div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={deleting}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? t('Deleting...') : t('Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
