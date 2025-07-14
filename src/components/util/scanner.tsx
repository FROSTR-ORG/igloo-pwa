import { useEffect, useRef, useState } from 'react'

import QrScanner from 'qr-scanner'

interface QRScannerProps {
  onResult: (result: string) => void
  onError?: (error: Error) => void
  onClose?: () => void
}

export function QRScanner({ onResult, onError, onClose }: QRScannerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)

  const [ error,   setError ] = useState<string | null>(null)
  const [ hasPerm, setPerm  ] = useState<boolean | null>(null)
  const [ isScanning, setIsScanning ] = useState(false)

  useEffect(() => {
    let scanner: QrScanner | null = null

    const initializeScanner = async () => {
      if (!videoRef.current) {
        setError('Video element not found')
        return
      }

      try {
        scanner = new QrScanner(
          videoRef.current,
          (result : QrScanner.ScanResult) => {
            console.log('QR Code detected:', result.data)
            onResult(result.data)
            scanner?.stop()
            setIsScanning(false)
          },
          { 
            returnDetailedScanResult: true,
            // More aggressive scanning
            highlightScanRegion: true,
            highlightCodeOutline: true,
            // Improve detection
            preferredCamera: 'environment', // Use back camera on mobile
            maxScansPerSecond: 10, // Increase scan frequency
          }
        )

        // Start scanning
        await scanner.start()
        setError(null)
        setPerm(true)
        setIsScanning(true)
        scannerRef.current = scanner
        
        console.log('QR Scanner started successfully')
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to initialize scanner')
        console.error('QR Scanner error:', error)
        setError(error.message)
        setIsScanning(false)
        if (onError) {
          onError(error)
        }
      }
    }

    initializeScanner()

    return () => {
      if (scanner) {
        scanner.stop()
        scanner.destroy()
        setIsScanning(false)
      }
    }
  }, [onResult, onError])

  return (
    <div className="scanner-popup-overlay">
      <div className="scanner-popup">
        <div className="scanner-popup-header">
          <h3>Scan QR Code</h3>
          <button 
            className="scanner-close-btn"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="scanner-container">
          <video 
            ref={videoRef} 
            className="scanner-video" 
            playsInline 
            autoPlay 
            muted
          />
          {isScanning && (
            <div className="scanner-status">
              <div className="scanner-crosshair"></div>
              <p className="scanner-instructions">
                Position the QR code within the frame
              </p>
            </div>
          )}
          {error && (
            <div className="scanner-error">
              {error}
              {hasPerm === false && (
                <div className="scanner-error-permission">
                  Please grant camera permissions to use the QR scanner
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 