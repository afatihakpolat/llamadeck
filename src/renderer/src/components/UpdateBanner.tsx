import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { X, Download, Loader2 } from 'lucide-react'
export default function UpdateBanner() {
  const { releaseInfo, updateDismissed, setUpdateDismissed, downloadProgress, setDownloadProgress, setBackends } = useStore()
  const [downloading, setDownloading] = useState(false)
  const [selectedAssetUrl, setSelectedAssetUrl] = useState('')
  useEffect(() => {
    if (releaseInfo?.assets.length && !selectedAssetUrl) {
      setSelectedAssetUrl(releaseInfo.assets[0].downloadUrl)
    }
  }, [releaseInfo, selectedAssetUrl])
  const notifPref = localStorage.getItem('hexllama_update_notify') || 'banner'
  if (!releaseInfo || releaseInfo.error || updateDismissed || releaseInfo.isNewer === false || notifPref === 'manual') return null
  const handleDownload = async () => {
    if (!releaseInfo.assets.length) return
    const asset = releaseInfo.assets.find(a => a.downloadUrl === selectedAssetUrl) || releaseInfo.assets[0]
    setDownloading(true)
    const res = await window.api.downloadRelease({
      url: asset.downloadUrl,
      version: `${releaseInfo.tagName}-${asset.name.replace('.zip', '')}`,
      assetName: asset.name
    })
    setDownloading(false)
    setDownloadProgress(null)
    if (res.success) {
      alert(`Successfully downloaded and extracted ${asset.name}`)
      setUpdateDismissed(true)
      const backendsData = await window.api.listBackends()
      setBackends(backendsData)
    } else {
      alert(`Download failed: ${res.error}`)
    }
  }
  return (
    <div className="update-banner">
      {downloadProgress || downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
      <span>
        <strong>{releaseInfo.name || releaseInfo.tagName}</strong> is available —{' '}
        <button onClick={() => window.api.openExternal(releaseInfo.url)}>
          View release
        </button>
        {releaseInfo.assets.length > 0 && (
          <>
            {' '}·{' '}
            {downloading || downloadProgress ? (
              <span style={{ opacity: 0.8 }}>
                {downloadProgress?.phase === 'extracting' ? 'Extracting...' : `Downloading... ${downloadProgress?.percent || 0}%`}
              </span>
            ) : (
              <>
                <select 
                  style={{ background: 'transparent', color: 'inherit', border: 'none', outline: 'none', borderBottom: '1px solid rgba(255,255,255,0.2)', marginRight: '8px', maxWidth: '200px' }}
                  value={selectedAssetUrl} 
                  onChange={(e) => setSelectedAssetUrl(e.target.value)}
                >
                  {releaseInfo.assets.map(a => (
                    <option style={{ color: 'black' }} key={a.downloadUrl} value={a.downloadUrl}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button onClick={handleDownload}>
                  Download
                </button>
              </>
            )}
          </>
        )}
      </span>
      {downloadProgress || downloading ? (
        <button 
          className="dismiss text-danger" 
          onClick={() => { window.api.cancelBackendDownload(); setDownloading(false); setDownloadProgress(null); }} 
          title="Cancel Download"
        >
          Cancel
        </button>
      ) : (
        <button className="dismiss" onClick={() => setUpdateDismissed(true)} title="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
