import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../api'

export default function ExportDialog({
  isOpen,
  onClose,
  truckIds = [],
  defaultTruckId = 'all',
  companyName,
  mode = 'metrics',
  defaultFormat = 'pdf',
  onExport
}) {
  const { t } = useTranslation()
  const resolvedCompanyName = companyName || t('Smart Waste System')
  const isTrucksMode = mode === 'trucks'
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    truckId: String(defaultTruckId || 'all'),
    waste: true,
    co2: true,
    co: true,
    format: defaultFormat || 'pdf'
  })
  const [errors, setErrors] = useState([])
  const [showValidation, setShowValidation] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShowValidation(false)
      setErrors([])
    }
  }, [isOpen])

  function onChange(e) {
    const { name, type } = e.target
    const value = type === 'checkbox' ? e.target.checked : e.target.value
    setFilters((prev) => {
      const next = { ...prev, [name]: value }
      if (showValidation) setErrors(validate(next))
      return next
    })
  }

  function validate(currentFilters = filters) {
    const errs = []
    const { fromDate, toDate, waste, co2, co, truckId, format } = currentFilters

    if (isTrucksMode) {
      if (format !== 'csv' && format !== 'pdf') errs.push(t('Choose a valid format: CSV or PDF.'))
      return errs
    }

    if (!fromDate || !toDate) {
      errs.push(t('Select both From and To date-times.'))
    } else {
      const start = new Date(fromDate)
      const end = new Date(toDate)
      if (isNaN(start) || isNaN(end)) {
        errs.push(t('Provide valid start and end date-times.'))
      } else if (start > end) {
        errs.push(t('Start date-time must be before End date-time.'))
      }
    }
    if (!waste && !co2 && !co) errs.push(t('Select at least one data type: Waste, CO2, or CO.'))
    if (format !== 'csv' && format !== 'pdf') errs.push(t('Choose a valid format: CSV or PDF.'))
    if (truckId !== 'all') {
      const valid = truckIds.map(String).includes(String(truckId))
      if (!valid) errs.push(t('Select a valid truck.'))
    }
    return errs
  }

  async function extractErrorMessages(err) {
    const msgs = []
    const resp = err && err.response
    if (resp && typeof resp.data !== 'undefined') {
      const data = resp.data
      if (data instanceof Blob) {
        let text = ''
        try {
          text = await data.text()
        } catch {
          text = ''
        }
        try {
          const json = JSON.parse(text)
          if (json && json.message) msgs.push(String(json.message))
          else if (text) msgs.push(text)
        } catch {
          if (text) msgs.push(text)
        }
      } else if (typeof data === 'string') {
        msgs.push(data)
      } else if (data && data.message) {
        msgs.push(String(data.message))
      }
    }
    if (!msgs.length) msgs.push(t('Download failed. Please try again.'))
    return msgs
  }

  function triggerDownloadBlob(data, headers, filename, fallbackType) {
    const type = (headers && headers['content-type']) || fallbackType || 'application/octet-stream'
    const blob = data instanceof Blob ? data : new Blob([data], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleDownload() {
    setShowValidation(true)
    const errs = validate()
    if (errs.length) {
      setErrors(errs)
      return
    }
    setErrors([])

    if (isTrucksMode) {
      try {
        if (typeof onExport !== 'function') {
          setErrors([t('Download failed. Please try again.')])
          return
        }
        await onExport({ format: filters.format })
        setErrors([])
        onClose()
      } catch (err) {
        const msg = err?.message || t('Download failed. Please try again.')
        setErrors([msg])
      }
      return
    }

    const { fromDate, toDate, truckId, waste, co2, co, format } = filters
    const params = {}
    if (truckId !== 'all') params.truckId = truckId
    
    // Send the raw local date-time strings so server filters match the selected range
    if (fromDate) params.start = fromDate
    if (toDate) params.end = toDate
    
    params.waste = waste ? '1' : '0'
    params.co2 = co2 ? '1' : '0'
    params.co = co ? '1' : '0'

    if (format === 'csv') {
      try {
        const res = await api.get('/export/csv', { params, responseType: 'blob' })
        triggerDownloadBlob(res.data, res.headers, 'dashboard_data.csv', 'text/csv')
        setErrors([])
        onClose()
      } catch (err) {
        const msgs = await extractErrorMessages(err)
        setErrors(msgs)
      }
      return
    }

    try {
      const res = await api.get('/export/pdf', { params, responseType: 'blob' })
      triggerDownloadBlob(res.data, res.headers, 'dashboard_data.pdf', 'application/pdf')
      setErrors([])
      onClose()
    } catch (err) {
      const msgs = await extractErrorMessages(err)
      setErrors(msgs)
    }
  }

  function getSummaryText() {
    const { fromDate, toDate, truckId, waste, co2, co } = filters
    const metrics = []
    if (waste) metrics.push(t('Waste'))
    if (co2) metrics.push(t('CO2'))
    if (co) metrics.push(t('CO'))
    
    const metricsText = metrics.join(', ')
    const truckText =
      truckId !== 'all'
        ? t('for Truck {{id}}', { id: truckId })
        : t('for All Trucks')
    return t('Exporting {{metrics}} data {{truck}} from {{from}} to {{to}}', {
      metrics: metricsText,
      truck: truckText,
      from: fromDate,
      to: toDate,
    })
  }

  const dateMissing = !isTrucksMode && (!filters.fromDate || !filters.toDate)
  const dateInvalidOrder =
    !isTrucksMode && filters.fromDate && filters.toDate && new Date(filters.fromDate) > new Date(filters.toDate)
  const metricNone = !isTrucksMode && !filters.waste && !filters.co2 && !filters.co
  const invalidTruck = !isTrucksMode && filters.truckId !== 'all' && !truckIds.map(String).includes(String(filters.truckId))
  const showDateError = !isTrucksMode && showValidation && (dateMissing || dateInvalidOrder)

  if (!isOpen) return null

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>{isTrucksMode ? t('Export trucks') : t('Download data')}</h2>
        <div className="hint">{resolvedCompanyName}</div>
        
        {/* Show active filters summary */}
        {!isTrucksMode && filters.fromDate && filters.toDate && !showValidation && (
          <div className="info" style={{ marginBottom: '12px' }}>
            {getSummaryText()}
          </div>
        )}
        
        <div className="modal-body">
          {isTrucksMode ? (
            <>
              <div className="modal-row">
                <div className="modal-field">
                  <label>{t('Format')}</label>
                  <select name="format" value={filters.format} onChange={onChange}>
                    <option value="csv">{t('CSV')}</option>
                  </select>
                </div>
              </div>
              <div className="hint">{t('Exports the current truck list with the active filters.')}</div>
            </>
          ) : (
            <>
              <div className="modal-row">
                <div className="modal-field">
                  <label>{t('From')}</label>
                  <input
                    type="datetime-local"
                    name="fromDate"
                    value={filters.fromDate}
                    onChange={onChange}
                    className={showDateError ? 'invalid' : ''}
                  />
                </div>
                <div className="modal-field">
                  <label>{t('To')}</label>
                  <input
                    type="datetime-local"
                    name="toDate"
                    value={filters.toDate}
                    onChange={onChange}
                    className={showDateError ? 'invalid' : ''}
                  />
                </div>
              </div>

              <div className="modal-row">
                <div className="modal-field">
                  <label>{t('Truck')}</label>
                  <select name="truckId" value={filters.truckId} onChange={onChange}>
                    <option value="all">{t('All')}</option>
                    {truckIds.map((id) => (
                      <option key={id} value={id}>
                        {t('Truck {{id}}', { id })}
                      </option>
                    ))}
                  </select>
                  {invalidTruck && <div className="error-msg">{t('Select a valid truck.')}</div>}
                </div>

                <div className="modal-field">
                  <label>{t('Data')}</label>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <label>
                      <input type="checkbox" name="waste" checked={filters.waste} onChange={onChange} /> {t('Waste')}
                    </label>
                    <label>
                      <input type="checkbox" name="co2" checked={filters.co2} onChange={onChange} /> {t('CO2')}
                    </label>
                    <label>
                      <input type="checkbox" name="co" checked={filters.co} onChange={onChange} /> {t('CO')}
                    </label>
                  </div>
                  {metricNone && <div className="error-msg">{t('Select at least one data type.')}</div>}
                </div>
              </div>

              <div className="modal-row">
                <div className="modal-field">
                  <label>{t('Format')}</label>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <label>
                      <input type="radio" name="format" value="csv" checked={filters.format === 'csv'} onChange={onChange} /> {t('CSV')}
                    </label>
                    <label>
                      <input type="radio" name="format" value="pdf" checked={filters.format === 'pdf'} onChange={onChange} /> {t('PDF')}
                    </label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {errors.length > 0 && (
          <div className="modal-errors" role="alert">
            {errors.map((e, idx) => (
              <div key={idx}>{t(e)}</div>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('Close')}</button>
          <button className="btn-primary" onClick={handleDownload}>{t('Download')}</button>
        </div>
      </div>
    </div>
  )
}
