import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const statusColors = {
  pending: { bg: "var(--expense-bg)", color: "var(--expense)" },
  reviewed: { bg: "var(--payroll-bg)", color: "var(--payroll)" },
  linked: { bg: "var(--income-bg)", color: "var(--income)" },
};

// ── Upload Zone ───────────────────────────────────────────────
function UploadZone({ onUploaded, t }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const inputRef = useRef();
  const videoRef = useRef();
  const canvasRef = useRef();

  // Start camera stream
  const startCamera = async () => {
    setError("");
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, // use back camera on phones
      });
      setStream(mediaStream);
      setShowCamera(true);
      // Wait for next render then attach stream to video element
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setError(t("receipts.cameraDenied"));
      } else if (err.name === "NotFoundError") {
        setError(t("receipts.cameraNotFound"));
      } else {
        setError(t("receipts.cameraError"));
      }
    }
  };

  // Stop camera stream
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setShowCamera(false);
    setCapturedImage(null);
  };

  // Capture photo from video stream
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(imageDataUrl);
    // Pause video to show captured frame
    video.pause();
  };

  // Retake photo
  const retakePhoto = () => {
    setCapturedImage(null);
    if (videoRef.current) videoRef.current.play();
  };

  // Convert base64 to File and upload
  const uploadCapturedPhoto = async () => {
    if (!capturedImage) return;
    setUploading(true);
    setError("");
    try {
      // Convert data URL to blob
      const res = await fetch(capturedImage);
      const blob = await res.blob();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], `receipt-${timestamp}.jpg`, {
        type: "image/jpeg",
      });
      stopCamera();
      await uploadFile(file);
    } catch {
      setError(t("receipts.captureFailed"));
      setUploading(false);
    }
  };

  // Shared upload function
  const uploadFile = async (file) => {
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("receipt", file);
      const { data } = await api.post("/receipts/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded(data);
    } catch (err) {
      setError(err.response?.data?.error || t("receipts.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];
    if (!allowed.includes(file.type)) {
      return setError(t("receipts.errFileType"));
    }
    if (file.size > 10 * 1024 * 1024) {
      return setError(t("receipts.errFileSize"));
    }
    await uploadFile(file);
  };

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Camera modal */}
      {showCamera && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 500,
              background: "var(--bg-primary)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {/* Camera header */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "0.5px solid var(--border-color)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                {capturedImage
                  ? t("receipts.reviewPhoto")
                  : t("receipts.takePhotoTitle")}
              </div>
              <button
                onClick={stopCamera}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: 20,
                }}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>

            {/* Video / captured image */}
            <div
              style={{
                position: "relative",
                background: "#000",
                aspectRatio: "4/3",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: capturedImage ? "none" : "block",
                }}
              />
              {capturedImage && (
                <img
                  src={capturedImage}
                  alt={t("receipts.capturedAlt")}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>

            {/* Camera controls */}
            <div
              style={{
                padding: 16,
                display: "flex",
                gap: 10,
                justifyContent: "center",
              }}
            >
              {!capturedImage ? (
                <>
                  <button
                    onClick={stopCamera}
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={capturePhoto}
                    className="btn btn-primary"
                    style={{ flex: 2 }}
                  >
                    <i className="ti ti-camera" aria-hidden="true" />{" "}
                    {t("receipts.capture")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={retakePhoto}
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                  >
                    <i className="ti ti-refresh" aria-hidden="true" />{" "}
                    {t("receipts.retake")}
                  </button>
                  <button
                    onClick={uploadCapturedPhoto}
                    className="btn btn-primary"
                    style={{ flex: 2 }}
                    disabled={uploading}
                  >
                    {uploading ? (
                      t("receipts.processing")
                    ) : (
                      <>
                        <i className="ti ti-sparkles" aria-hidden="true" />{" "}
                        {t("receipts.useThisPhoto")}
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload zone */}
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files[0]);
        }}
        style={{
          border: `2px dashed ${dragging ? "var(--brand)" : "var(--border-color)"}`,
          borderRadius: 12,
          padding: "28px 24px",
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          background: dragging ? "var(--brand-light)" : "var(--bg-primary)",
          transition: "all 0.15s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => upload(e.target.files[0])}
        />

        {uploading ? (
          <>
            <i
              className="ti ti-loader-2"
              style={{
                fontSize: 36,
                color: "var(--brand)",
                animation: "spin 1s linear infinite",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                marginTop: 10,
              }}
            >
              {t("receipts.uploadingScanning")}
            </div>
          </>
        ) : (
          <>
            <i
              className="ti ti-receipt"
              style={{ fontSize: 36, color: "var(--text-muted)" }}
              aria-hidden="true"
            />
            <div
              style={{
                color: "var(--text-primary)",
                fontSize: 14,
                fontWeight: 500,
                marginTop: 10,
                marginBottom: 4,
              }}
            >
              {t("receipts.addReceipt")}
            </div>
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              {t("receipts.fileHint")}
            </div>

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startCamera();
                }}
                className="btn btn-primary"
                style={{ fontSize: 13 }}
              >
                <i className="ti ti-camera" aria-hidden="true" />{" "}
                {t("receipts.takePhoto")}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
                className="btn btn-secondary"
                style={{ fontSize: 13 }}
              >
                <i className="ti ti-upload" aria-hidden="true" />{" "}
                {t("receipts.uploadFile")}
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "var(--danger-bg)",
            color: "var(--danger)",
            border: "0.5px solid var(--danger)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            marginTop: 10,
          }}
        >
          <i
            className="ti ti-alert-circle"
            style={{ marginRight: 6 }}
            aria-hidden="true"
          />
          {error}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Receipt Detail Modal ──────────────────────────────────────
function ReceiptModal({ receipt, onClose, transactions, accounts, fmt, t }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1); // 1 = edit data, 2 = choose action
  const [form, setForm] = useState({
    merchant: receipt.ai_merchant || "",
    date: receipt.ai_date ? dayjs(receipt.ai_date).format("YYYY-MM-DD") : "",
    total: receipt.ai_total || "",
    lineItems: receipt.ai_line_items || [],
  });
  const [action, setAction] = useState(null); // "link" | "create"
  const [linkTxId, setLinkTxId] = useState("");
  const [newTx, setNewTx] = useState({
    accountId: "",
    type: "expense",
    notes: "",
  });
  const [error, setError] = useState("");
  const confidence = parseFloat(receipt.ai_confidence || 0);

  // Save edited receipt data
  const reviewMutation = useMutation({
    mutationFn: () =>
      api.put(`/receipts/${receipt.id}/review`, {
        merchant: form.merchant || undefined,
        date: form.date || undefined,
        total: form.total ? parseFloat(form.total) : undefined,
        lineItems: form.lineItems,
      }),
  });

  // Link to existing transaction
  const linkMutation = useMutation({
    mutationFn: () =>
      api.put(`/receipts/${receipt.id}/link`, { transactionId: linkTxId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("receipts.linkFailed")),
  });

  // Create new transaction from receipt data
  const createTxMutation = useMutation({
    mutationFn: async () => {
      // First create the transaction
      const txRes = await api.post("/transactions", {
        accountId: newTx.accountId,
        date: form.date || dayjs().format("YYYY-MM-DD"),
        merchant: form.merchant || undefined,
        totalAmount: parseFloat(form.total || 0),
        type: newTx.type,
        notes: newTx.notes || undefined,
        receiptId: receipt.id,
      });
      // Then link the receipt to it
      await api.put(`/receipts/${receipt.id}/link`, {
        transactionId: txRes.data.id,
      });
      return txRes.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      onClose();
    },
    onError: (err) =>
      setError(err.response?.data?.error || t("receipts.createTxFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/receipts/${receipt.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipts"] });
      onClose();
    },
  });

  const handleNextStep = async () => {
    setError("");
    // Save any edits to receipt data first
    try {
      await reviewMutation.mutateAsync();
      setStep(2);
    } catch {
      setError(t("receipts.saveDataFailed"));
    }
  };

  const handleConfirmAction = () => {
    setError("");
    if (action === "link") {
      if (!linkTxId) return setError(t("receipts.errSelectTx"));
      linkMutation.mutate();
    } else if (action === "create") {
      if (!newTx.accountId) return setError(t("receipts.errSelectAccount"));
      if (!form.total || parseFloat(form.total) <= 0)
        return setError(t("receipts.errValidTotal"));
      createTxMutation.mutate();
    }
  };

  const isProcessing =
    linkMutation.isPending ||
    createTxMutation.isPending ||
    reviewMutation.isPending;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="card fade-in"
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 24,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {step === 1
                ? t("receipts.reviewDataTitle")
                : t("receipts.chooseActionTitle")}
            </h2>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}
            >
              {t("receipts.stepOfTwo", { step })}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 20,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {/* Step indicator */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 20,
            alignItems: "center",
          }}
        >
          {[1, 2].map((s) => (
            <div
              key={s}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  background:
                    step >= s ? "var(--brand)" : "var(--border-color)",
                  color: step >= s ? "#fff" : "var(--text-muted)",
                }}
              >
                {step > s ? (
                  <i
                    className="ti ti-check"
                    style={{ fontSize: 12 }}
                    aria-hidden="true"
                  />
                ) : (
                  s
                )}
              </div>
              <span
                style={{
                  fontSize: 12,
                  color:
                    step >= s ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: step === s ? 500 : 400,
                }}
              >
                {s === 1
                  ? t("receipts.stepReviewData")
                  : t("receipts.stepLinkOrCreate")}
              </span>
              {s < 2 && (
                <div
                  style={{
                    width: 24,
                    height: 1,
                    background: "var(--border-color)",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: "var(--danger-bg)",
              color: "var(--danger)",
              border: "0.5px solid var(--danger)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <i
              className="ti ti-alert-circle"
              style={{ marginRight: 6 }}
              aria-hidden="true"
            />
            {error}
          </div>
        )}

        {/* ── STEP 1: Edit extracted data ── */}
        {step === 1 && (
          <div>
            {/* Confidence bar */}
            <div
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                background: "var(--bg-secondary)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {t("receipts.aiConfidence")}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color:
                      confidence >= 0.7
                        ? "var(--income)"
                        : confidence >= 0.4
                          ? "var(--payroll)"
                          : "var(--expense)",
                  }}
                >
                  {Math.round(confidence * 100)}%
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  background: "var(--border-color)",
                  borderRadius: 2,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${confidence * 100}%`,
                    background:
                      confidence >= 0.7
                        ? "var(--income)"
                        : confidence >= 0.4
                          ? "var(--payroll)"
                          : "var(--expense)",
                    borderRadius: 2,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginBottom: 12,
              }}
            >
              {t("receipts.reviewHint")}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="label" htmlFor="r-merchant">
                {t("common.merchant")}
              </label>
              <input
                id="r-merchant"
                className="input"
                value={form.merchant}
                onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                placeholder={t("receipts.merchantPlaceholder")}
                autoFocus
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label className="label" htmlFor="r-date">
                  {t("common.date")}
                </label>
                <input
                  id="r-date"
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="r-total">
                  {t("receipts.totalAmount")}
                </label>
                <input
                  id="r-total"
                  className="input"
                  type="number"
                  step="0.01"
                  value={form.total}
                  onChange={(e) => setForm({ ...form, total: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Editable line items */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                }}
              >
                {t("receipts.lineItems")}{" "}
                {form.lineItems.length === 0 && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    {t("receipts.noneDetected")}
                  </span>
                )}
              </div>
              {form.lineItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 30px",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <input
                    className="input"
                    value={item.description}
                    onChange={(e) => {
                      const updated = [...form.lineItems];
                      updated[i] = {
                        ...updated[i],
                        description: e.target.value,
                      };
                      setForm({ ...form, lineItems: updated });
                    }}
                    placeholder={t("receipts.itemDescription")}
                  />
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={item.total}
                    onChange={(e) => {
                      const updated = [...form.lineItems];
                      updated[i] = {
                        ...updated[i],
                        total: parseFloat(e.target.value),
                      };
                      setForm({ ...form, lineItems: updated });
                    }}
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        lineItems: form.lineItems.filter((_, idx) => idx !== i),
                      })
                    }
                    style={{
                      background: "var(--danger-bg)",
                      color: "var(--danger)",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    lineItems: [
                      ...form.lineItems,
                      { description: "", total: 0 },
                    ],
                  })
                }
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: "5px 10px", marginTop: 4 }}
              >
                <i className="ti ti-plus" aria-hidden="true" />{" "}
                {t("receipts.addLineItem")}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <button
                onClick={() => {
                  if (window.confirm(t("receipts.confirmDelete")))
                    deleteMutation.mutate();
                }}
                className="btn btn-danger"
                disabled={receipt.status === "linked"}
              >
                <i className="ti ti-trash" aria-hidden="true" />{" "}
                {t("common.delete")}
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} className="btn btn-secondary">
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleNextStep}
                  className="btn btn-primary"
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending
                    ? t("receipts.saving")
                    : t("receipts.next")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Choose action ── */}
        {step === 2 && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 20,
              }}
            >
              {/* Link to existing */}
              <div
                onClick={() => setAction("link")}
                style={{
                  padding: 16,
                  borderRadius: 10,
                  border: `1.5px solid ${action === "link" ? "var(--brand)" : "var(--border-color)"}`,
                  background:
                    action === "link"
                      ? "var(--brand-light)"
                      : "var(--bg-primary)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  textAlign: "center",
                }}
              >
                <i
                  className="ti ti-link"
                  style={{
                    fontSize: 28,
                    color:
                      action === "link" ? "var(--brand)" : "var(--text-muted)",
                  }}
                  aria-hidden="true"
                />
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color:
                      action === "link"
                        ? "var(--brand)"
                        : "var(--text-primary)",
                    marginTop: 8,
                  }}
                >
                  {t("receipts.linkToExisting")}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                  }}
                >
                  {t("receipts.linkToExistingHint")}
                </div>
              </div>

              {/* Create new */}
              <div
                onClick={() => setAction("create")}
                style={{
                  padding: 16,
                  borderRadius: 10,
                  border: `1.5px solid ${action === "create" ? "var(--brand)" : "var(--border-color)"}`,
                  background:
                    action === "create"
                      ? "var(--brand-light)"
                      : "var(--bg-primary)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  textAlign: "center",
                }}
              >
                <i
                  className="ti ti-plus"
                  style={{
                    fontSize: 28,
                    color:
                      action === "create"
                        ? "var(--brand)"
                        : "var(--text-muted)",
                  }}
                  aria-hidden="true"
                />
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color:
                      action === "create"
                        ? "var(--brand)"
                        : "var(--text-primary)",
                    marginTop: 8,
                  }}
                >
                  {t("receipts.createNew")}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                  }}
                >
                  {t("receipts.createNewHint")}
                </div>
              </div>
            </div>

            {/* Receipt summary */}
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 6,
                }}
              >
                {t("receipts.receiptSummary")}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    {form.merchant || t("receipts.unknownMerchant")}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {form.date
                      ? dayjs(form.date).format("MMM D, YYYY")
                      : t("receipts.noDate")}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {form.total ? fmt(form.total) : "—"}
                </div>
              </div>
            </div>

            {/* Link form */}
            {action === "link" && (
              <div style={{ marginBottom: 16 }}>
                <label className="label" htmlFor="linkTx">
                  {t("receipts.selectTransaction")}
                </label>
                <select
                  id="linkTx"
                  className="input"
                  value={linkTxId}
                  onChange={(e) => setLinkTxId(e.target.value)}
                >
                  <option value="">{t("receipts.chooseTransaction")}</option>
                  {transactions?.map((tx) => (
                    <option key={tx.id} value={tx.id}>
                      {dayjs(tx.date).format("MMM D")} —{" "}
                      {tx.merchant || t("dashboard.noMerchant")} —{" "}
                      {fmt(tx.total_amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Create form */}
            {action === "create" && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <label className="label" htmlFor="new-account">
                      {t("common.account")}
                    </label>
                    <select
                      id="new-account"
                      className="input"
                      value={newTx.accountId}
                      onChange={(e) =>
                        setNewTx({ ...newTx, accountId: e.target.value })
                      }
                    >
                      <option value="">{t("receipts.selectAccount")}</option>
                      {accounts?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="new-type">
                      {t("common.type")}
                    </label>
                    <select
                      id="new-type"
                      className="input"
                      value={newTx.type}
                      onChange={(e) =>
                        setNewTx({ ...newTx, type: e.target.value })
                      }
                    >
                      <option value="expense">{t("common.expense")}</option>
                      <option value="income">{t("common.income")}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="new-notes">
                    {t("receipts.notesOptional")}
                  </label>
                  <input
                    id="new-notes"
                    className="input"
                    value={newTx.notes}
                    onChange={(e) =>
                      setNewTx({ ...newTx, notes: e.target.value })
                    }
                    placeholder={t("receipts.notesPlaceholder")}
                  />
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <button
                onClick={() => {
                  setStep(1);
                  setError("");
                }}
                className="btn btn-secondary"
              >
                {t("receipts.back")}
              </button>
              <button
                onClick={handleConfirmAction}
                className="btn btn-primary"
                disabled={!action || isProcessing}
              >
                {isProcessing
                  ? t("receipts.processing")
                  : action === "link"
                    ? t("receipts.linkReceipt")
                    : action === "create"
                      ? t("receipts.createTransaction")
                      : t("receipts.selectAnOption")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Receipts Page ────────────────────────────────────────
export default function Receipts() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const fmt = makeFmt(i18n.language);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: receipts, isLoading } = useQuery({
    queryKey: ["receipts", statusFilter],
    queryFn: () => {
      const params = statusFilter ? `?status=${statusFilter}` : "";
      return api.get(`/receipts${params}`).then((r) => r.data);
    },
  });

  const { data: txData } = useQuery({
    queryKey: ["transactions", {}],
    queryFn: () => api.get("/transactions?limit=100").then((r) => r.data),
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get("/accounts").then((r) => r.data),
  });

  const handleUploaded = (receipt) => {
    queryClient.invalidateQueries({ queryKey: ["receipts"] });
    setSelectedReceipt(receipt);
  };

  // Localized status label (DB stores pending/reviewed/linked)
  const statusLabel = (s) => t(`receipts.status.${s}`, s);

  return (
    <div className="fade-in">
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 4,
            }}
          >
            {t("receipts.title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("receipts.count", { count: receipts?.length || 0 })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["", "pending", "reviewed", "linked"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "0.5px solid",
                borderColor:
                  statusFilter === s ? "var(--brand)" : "var(--border-color)",
                background:
                  statusFilter === s ? "var(--brand-light)" : "transparent",
                color:
                  statusFilter === s ? "var(--brand)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: statusFilter === s ? 500 : 400,
              }}
            >
              {s ? statusLabel(s) : t("common.all")}
            </button>
          ))}
        </div>
      </div>

      {/* Upload zone */}
      <UploadZone onUploaded={handleUploaded} t={t} />

      {/* Receipts grid */}
      {isLoading ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          {t("common.loading")}
        </div>
      ) : receipts?.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <i
            className="ti ti-receipt-off"
            style={{ fontSize: 36, color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <div
            style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}
          >
            {t("receipts.noneYet")}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {receipts.map((r) => (
            <div
              key={r.id}
              className="card"
              style={{
                padding: "16px 18px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onClick={() => setSelectedReceipt(r)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor = "var(--brand)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.borderColor = "var(--border-color)")
              }
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <i
                    className="ti ti-receipt"
                    style={{ fontSize: 20, color: "var(--text-muted)" }}
                    aria-hidden="true"
                  />
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {r.ai_merchant || t("receipts.unknownMerchant")}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 1,
                      }}
                    >
                      {r.ai_date
                        ? dayjs(r.ai_date).format("MMM D, YYYY")
                        : t("receipts.noDate")}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontWeight: 500,
                    background: statusColors[r.status]?.bg,
                    color: statusColors[r.status]?.color,
                  }}
                >
                  {statusLabel(r.status)}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {r.ai_total ? fmt(r.ai_total) : "—"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {r.ai_confidence
                    ? t("receipts.confidencePct", {
                        pct: Math.round(r.ai_confidence * 100),
                      })
                    : ""}
                </div>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 8,
                }}
              >
                {r.original_filename} · {dayjs(r.created_at).format("MMM D")}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedReceipt && (
        <ReceiptModal
          receipt={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          transactions={txData?.transactions}
          accounts={accounts}
          fmt={fmt}
          t={t}
        />
      )}
    </div>
  );
}
