import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import dayjs from "dayjs";
import { coaToCategories } from "../lib/coaCategories";
import { confirmDialog } from "../store/feedbackStore";
import cx from "../lib/cx";
import SplitEditor from "../components/SplitEditor";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Toggle,
} from "../components/ui";

const makeFmt =
  (lang) =>
  (val, currency = "USD") =>
    new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
      style: "currency",
      currency,
    }).format(val || 0);

const STATUS_TONES = {
  pending: "expense",
  reviewed: "payroll",
  linked: "income",
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
      // The scan-limit 403 gets a friendly upsell instead of raw error text.
      if (err.response?.data?.code === "UPGRADE_REQUIRED") {
        setError({
          upsell: true,
          used: err.response.data.used,
          limit: err.response.data.limit,
        });
      } else {
        setError(err.response?.data?.error || t("receipts.uploadFailed"));
      }
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
    <div className="mb-6">
      {/* Camera modal */}
      {showCamera && (
        <div className="fixed inset-0 z-[200] bg-black/85 flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-[500px] bg-surface rounded-xl overflow-hidden">
            {/* Camera header */}
            <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-line">
              <div className="text-sm font-medium text-ink">
                {capturedImage
                  ? t("receipts.reviewPhoto")
                  : t("receipts.takePhotoTitle")}
              </div>
              <button
                onClick={stopCamera}
                className="text-xl text-muted cursor-pointer"
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>

            {/* Video / captured image */}
            <div className="relative bg-black aspect-[4/3]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cx(
                  "w-full h-full object-cover",
                  capturedImage ? "hidden" : "block",
                )}
              />
              {capturedImage && (
                <img
                  src={capturedImage}
                  alt={t("receipts.capturedAlt")}
                  className="w-full h-full object-cover"
                />
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Camera controls */}
            <div className="flex gap-2.5 justify-center p-4">
              {!capturedImage ? (
                <>
                  <Button onClick={stopCamera} className="flex-1 justify-center">
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    icon="ti-camera"
                    onClick={capturePhoto}
                    className="flex-[2] justify-center"
                  >
                    {t("receipts.capture")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    icon="ti-refresh"
                    onClick={retakePhoto}
                    className="flex-1 justify-center"
                  >
                    {t("receipts.retake")}
                  </Button>
                  <Button
                    variant="primary"
                    icon={uploading ? undefined : "ti-sparkles"}
                    onClick={uploadCapturedPhoto}
                    disabled={uploading}
                    className="flex-[2] justify-center"
                  >
                    {uploading
                      ? t("receipts.processing")
                      : t("receipts.useThisPhoto")}
                  </Button>
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
        className={cx(
          "border-2 border-dashed rounded-xl px-6 py-7 text-center transition-all",
          uploading ? "cursor-wait" : "cursor-pointer",
          dragging ? "border-brand bg-brand-light" : "border-line bg-surface",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => upload(e.target.files[0])}
        />

        {uploading ? (
          <>
            <i
              className="ti ti-loader-2 text-4xl text-brand animate-spin"
              aria-hidden="true"
            />
            <div className="text-secondary text-md mt-2.5">
              {t("receipts.uploadingScanning")}
            </div>
          </>
        ) : (
          <>
            <i
              className="ti ti-receipt text-4xl text-muted"
              aria-hidden="true"
            />
            <div className="text-ink text-sm font-medium mt-2.5 mb-1">
              {t("receipts.addReceipt")}
            </div>
            <div className="text-muted text-xs mb-4">
              {t("receipts.fileHint")}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2.5 justify-center flex-wrap">
              <Button
                variant="primary"
                icon="ti-camera"
                onClick={(e) => {
                  e.stopPropagation();
                  startCamera();
                }}
              >
                {t("receipts.takePhoto")}
              </Button>
              <Button
                icon="ti-upload"
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                {t("receipts.uploadFile")}
              </Button>
            </div>
          </>
        )}
      </div>

      {error && error.upsell && (
        <div className="flex items-center gap-3 flex-wrap bg-brand-light border border-brand rounded-lg px-3.5 py-2.5 text-md text-ink mt-2.5">
          <i className="ti ti-sparkles text-brand" aria-hidden="true" />
          <span className="flex-1 min-w-[200px]">
            {t("receipts.scanLimitReached", {
              used: error.used,
              limit: error.limit,
            })}
          </span>
          <Link
            to="/plans"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-md font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-hover shrink-0"
          >
            <i className="ti ti-crown" aria-hidden="true" />
            {t("upgrade.viewPlans")}
          </Link>
        </div>
      )}
      {error && !error.upsell && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mt-2.5">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}
    </div>
  );
}

// Confidence color classes by score. Full literal class names so the
// Tailwind content scanner picks them up (no dynamic interpolation).
const CONFIDENCE_CLASSES = {
  high: { text: "text-income", bar: "bg-income" },
  medium: { text: "text-payroll", bar: "bg-payroll" },
  low: { text: "text-expense", bar: "bg-expense" },
};
const confidenceLevel = (c) => (c >= 0.7 ? "high" : c >= 0.4 ? "medium" : "low");

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
    accountId: "", // prefixed: "acct:<id>" (bank) or "coa:<id>" (ledger)
    type: "expense",
    categoryId: "",
    notes: "",
  });
  const [useSplit, setUseSplit] = useState(false);
  const [splits, setSplits] = useState([]);
  const [error, setError] = useState("");

  // Toggle split mode. On first enable, seed one split line per scanned
  // line item (amount + description) so only categories need picking.
  const toggleSplit = () => {
    if (!useSplit && splits.length === 0 && form.lineItems.length > 0) {
      setSplits(
        form.lineItems
          .filter((li) => parseFloat(li.total) > 0)
          .map((li) => ({
            categoryId: "",
            amount: li.total,
            notes: li.description || "",
          })),
      );
    }
    setUseSplit(!useSplit);
  };
  const confidence = parseFloat(receipt.ai_confidence || 0);

  // Categories + ledger funding sources come from the chart of accounts —
  // same shape as the add-transaction form in Transactions.jsx.
  const { data: coaGroups } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => api.get("/chart-of-accounts").then((r) => r.data),
  });
  const categories = useMemo(
    () => coaToCategories(coaGroups, t),
    [coaGroups, t],
  );
  // Asset & liability ledger accounts that can fund the transaction, minus
  // the COA "twin" of each operational bank account.
  const ledgerAccounts = useMemo(() => {
    if (!coaGroups) return [];
    const twinIds = new Set(
      (accounts || []).map((a) => a.coa_account_id).filter(Boolean),
    );
    const out = [];
    const walk = (acc) => {
      if (!twinIds.has(acc.id))
        out.push({
          id: acc.id,
          name: acc.name_key ? t(acc.name_key) : acc.name,
          code: acc.code,
        });
      acc.children?.forEach(walk);
    };
    for (const g of coaGroups) {
      if (g.account_type === "asset" || g.account_type === "liability")
        g.accounts.forEach(walk);
    }
    return out;
  }, [coaGroups, accounts, t]);

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
      // newTx.accountId is prefixed: "acct:<id>" (operational bank account)
      // or "coa:<id>" (asset/liability ledger account).
      const isLedgerFunded = newTx.accountId.startsWith("coa:");
      const fundingId = newTx.accountId.replace(/^(coa|acct):/, "");
      // First create the transaction
      const txRes = await api.post("/transactions", {
        ...(isLedgerFunded
          ? { fundingCoaId: fundingId }
          : { accountId: fundingId }),
        date: form.date || dayjs().format("YYYY-MM-DD"),
        merchant: form.merchant || undefined,
        totalAmount: parseFloat(form.total || 0),
        type: newTx.type,
        categoryId: useSplit ? undefined : newTx.categoryId,
        splits: useSplit ? splits : [],
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
      if (useSplit) {
        if (splits.length === 0)
          return setError(t("transactions.errAddSplit"));
      } else if (!newTx.categoryId) {
        return setError(t("receipts.errSelectCategory"));
      }
      if (!form.total || parseFloat(form.total) <= 0)
        return setError(t("receipts.errValidTotal"));
      createTxMutation.mutate();
    }
  };

  const isProcessing =
    linkMutation.isPending ||
    createTxMutation.isPending ||
    reviewMutation.isPending;

  const confCls = CONFIDENCE_CLASSES[confidenceLevel(confidence)];

  return (
    <Modal
      open
      onClose={onClose}
      title={
        step === 1
          ? t("receipts.reviewDataTitle")
          : t("receipts.chooseActionTitle")
      }
    >
      <div className="text-xs text-muted -mt-1 mb-3">
        {t("receipts.stepOfTwo", { step })}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-5">
        {[1, 2].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cx(
                "flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold",
                step >= s ? "bg-brand text-on-brand" : "bg-line text-muted",
              )}
            >
              {step > s ? (
                <i className="ti ti-check text-xs" aria-hidden="true" />
              ) : (
                s
              )}
            </div>
            <span
              className={cx(
                "text-xs",
                step >= s ? "text-ink" : "text-muted",
                step === s && "font-medium",
              )}
            >
              {s === 1
                ? t("receipts.stepReviewData")
                : t("receipts.stepLinkOrCreate")}
            </span>
            {s < 2 && <div className="w-6 h-px bg-line" />}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger-bg text-danger border border-danger rounded-lg px-3.5 py-2.5 text-md mb-4">
          <i className="ti ti-alert-circle mr-1.5" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* ── STEP 1: Edit extracted data ── */}
      {step === 1 && (
        <div>
          {/* Confidence bar */}
          <div className="mb-4 px-3.5 py-2.5 bg-canvas rounded-lg">
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-secondary">
                {t("receipts.aiConfidence")}
              </span>
              <span className={cx("text-xs font-medium", confCls.text)}>
                {Math.round(confidence * 100)}%
              </span>
            </div>
            <div className="h-1 bg-line rounded-sm">
              <div
                className={cx(
                  "h-full rounded-sm transition-all duration-300",
                  confCls.bar,
                )}
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
          </div>

          <div className="text-xs text-muted mb-3">
            {t("receipts.reviewHint")}
          </div>

          <Field label={t("common.merchant")} htmlFor="r-merchant" className="mb-3">
            <Input
              id="r-merchant"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
              placeholder={t("receipts.merchantPlaceholder")}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label={t("common.date")} htmlFor="r-date" className="mb-0">
              <Input
                id="r-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </Field>
            <Field
              label={t("receipts.totalAmount")}
              htmlFor="r-total"
              className="mb-0"
            >
              <Input
                id="r-total"
                type="number"
                step="0.01"
                value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>

          {/* Editable line items */}
          <div className="mb-4">
            <div className="text-xs font-medium text-secondary mb-2">
              {t("receipts.lineItems")}{" "}
              {form.lineItems.length === 0 && (
                <span className="text-muted font-normal">
                  {t("receipts.noneDetected")}
                </span>
              )}
            </div>
            {form.lineItems.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_90px_30px] gap-2 mb-2"
              >
                <Input
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
                <Input
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
                  className="flex items-center justify-center rounded-md bg-danger-bg text-danger cursor-pointer"
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              icon="ti-plus"
              className="mt-1"
              onClick={() =>
                setForm({
                  ...form,
                  lineItems: [...form.lineItems, { description: "", total: 0 }],
                })
              }
            >
              {t("receipts.addLineItem")}
            </Button>
          </div>

          <div className="flex gap-2 justify-between">
            <Button
              variant="danger"
              icon="ti-trash"
              disabled={receipt.status === "linked"}
              onClick={async () => {
                if (
                  await confirmDialog({
                    message: t("receipts.confirmDelete"),
                    danger: true,
                  })
                )
                  deleteMutation.mutate();
              }}
            >
              {t("common.delete")}
            </Button>
            <div className="flex gap-2">
              <Button onClick={onClose}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                onClick={handleNextStep}
                disabled={reviewMutation.isPending}
              >
                {reviewMutation.isPending
                  ? t("receipts.saving")
                  : t("receipts.next")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Choose action ── */}
      {step === 2 && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {/* Link to existing */}
            <div
              onClick={() => setAction("link")}
              className={cx(
                "p-4 rounded-card border-2 cursor-pointer transition-all text-center",
                action === "link"
                  ? "border-brand bg-brand-light"
                  : "border-line bg-surface",
              )}
            >
              <i
                className={cx(
                  "ti ti-link text-[28px]",
                  action === "link" ? "text-brand" : "text-muted",
                )}
                aria-hidden="true"
              />
              <div
                className={cx(
                  "text-md font-medium mt-2",
                  action === "link" ? "text-brand" : "text-ink",
                )}
              >
                {t("receipts.linkToExisting")}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {t("receipts.linkToExistingHint")}
              </div>
            </div>

            {/* Create new */}
            <div
              onClick={() => setAction("create")}
              className={cx(
                "p-4 rounded-card border-2 cursor-pointer transition-all text-center",
                action === "create"
                  ? "border-brand bg-brand-light"
                  : "border-line bg-surface",
              )}
            >
              <i
                className={cx(
                  "ti ti-plus text-[28px]",
                  action === "create" ? "text-brand" : "text-muted",
                )}
                aria-hidden="true"
              />
              <div
                className={cx(
                  "text-md font-medium mt-2",
                  action === "create" ? "text-brand" : "text-ink",
                )}
              >
                {t("receipts.createNew")}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {t("receipts.createNewHint")}
              </div>
            </div>
          </div>

          {/* Receipt summary */}
          <div className="bg-canvas rounded-lg px-3.5 py-3 mb-4">
            <div className="text-[11px] text-muted mb-1.5">
              {t("receipts.receiptSummary")}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-ink">
                  {form.merchant || t("receipts.unknownMerchant")}
                </div>
                <div className="text-xs text-muted">
                  {form.date
                    ? dayjs(form.date).format("MMM D, YYYY")
                    : t("receipts.noDate")}
                </div>
              </div>
              <div className="text-xl font-semibold text-ink">
                {form.total ? fmt(form.total) : "—"}
              </div>
            </div>
          </div>

          {/* Link form */}
          {action === "link" && (
            <Field
              label={t("receipts.selectTransaction")}
              htmlFor="linkTx"
              className="mb-4"
            >
              <Select
                id="linkTx"
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
              </Select>
            </Field>
          )}

          {/* Create form */}
          {action === "create" && (
            <div className="mb-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field
                  label={t("common.account")}
                  htmlFor="new-account"
                  className="mb-0"
                >
                  <Select
                    id="new-account"
                    value={newTx.accountId}
                    onChange={(e) =>
                      setNewTx({ ...newTx, accountId: e.target.value })
                    }
                  >
                    <option value="">{t("receipts.selectAccount")}</option>
                    {accounts?.length > 0 && (
                      <optgroup label={t("transactions.bankAccounts")}>
                        {accounts.map((a) => (
                          <option key={a.id} value={`acct:${a.id}`}>
                            {a.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {ledgerAccounts?.length > 0 && (
                      <optgroup label={t("transactions.ledgerAccounts")}>
                        {ledgerAccounts.map((a) => (
                          <option key={a.id} value={`coa:${a.id}`}>
                            {a.code ? `${a.code} · ${a.name}` : a.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </Field>
                <Field
                  label={t("common.type")}
                  htmlFor="new-type"
                  className="mb-0"
                >
                  <Select
                    id="new-type"
                    value={newTx.type}
                    onChange={(e) => {
                      // category list is type-filtered — reset picks on change
                      setNewTx({ ...newTx, type: e.target.value, categoryId: "" });
                      setSplits((prev) =>
                        prev.map((s) => ({ ...s, categoryId: "" })),
                      );
                    }}
                  >
                    <option value="expense">{t("common.expense")}</option>
                    <option value="income">{t("common.income")}</option>
                  </Select>
                </Field>
              </div>
              {/* Split toggle — same pattern as the transaction modal */}
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-canvas rounded-lg mb-3">
                <Toggle
                  checked={useSplit}
                  onChange={toggleSplit}
                  aria-label={t("transactions.toggleSplit")}
                />
                <div>
                  <div className="text-md font-medium text-ink">
                    {t("transactions.splitTransaction")}
                  </div>
                  <div className="text-[11px] text-muted">
                    {t("transactions.splitDescription")}
                  </div>
                </div>
              </div>

              {useSplit ? (
                <div className="mb-3 px-3.5 py-3 bg-canvas rounded-lg">
                  <div className="text-xs font-medium text-secondary mb-2">
                    {t("transactions.splitBreakdown")}
                  </div>
                  <SplitEditor
                    splits={splits}
                    setSplits={setSplits}
                    totalAmount={form.total}
                    categories={categories.filter(
                      (c) => c.type === newTx.type,
                    )}
                    fmt={fmt}
                    t={t}
                  />
                </div>
              ) : (
                <Field
                  label={t("common.category")}
                  htmlFor="new-category"
                  className="mb-3"
                >
                  <Select
                    id="new-category"
                    value={newTx.categoryId}
                    onChange={(e) =>
                      setNewTx({ ...newTx, categoryId: e.target.value })
                    }
                  >
                    <option value="">{t("transactions.selectACategory")}</option>
                    {categories
                      .filter((c) => c.type === newTx.type)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <Field
                label={t("receipts.notesOptional")}
                htmlFor="new-notes"
                className="mb-0"
              >
                <Input
                  id="new-notes"
                  value={newTx.notes}
                  onChange={(e) => setNewTx({ ...newTx, notes: e.target.value })}
                  placeholder={t("receipts.notesPlaceholder")}
                />
              </Field>
            </div>
          )}

          <div className="flex gap-2 justify-between">
            <Button
              onClick={() => {
                setStep(1);
                setError("");
              }}
            >
              {t("receipts.back")}
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmAction}
              disabled={!action || isProcessing}
            >
              {isProcessing
                ? t("receipts.processing")
                : action === "link"
                  ? t("receipts.linkReceipt")
                  : action === "create"
                    ? t("receipts.createTransaction")
                    : t("receipts.selectAnOption")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
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
      <PageHeader
        title={t("receipts.title")}
        subtitle={t("receipts.count", { count: receipts?.length || 0 })}
        actions={
          <>
            {["", "pending", "reviewed", "linked"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cx(
                  "px-3 py-1.5 rounded-md border text-xs cursor-pointer transition-colors",
                  statusFilter === s
                    ? "border-brand bg-brand-light text-brand font-medium"
                    : "border-line bg-transparent text-muted",
                )}
              >
                {s ? statusLabel(s) : t("common.all")}
              </button>
            ))}
          </>
        }
      />

      {/* Upload zone */}
      <UploadZone onUploaded={handleUploaded} t={t} />

      {/* Receipts grid */}
      {isLoading ? (
        <div className="p-8 text-center text-muted">{t("common.loading")}</div>
      ) : receipts?.length === 0 ? (
        <Card>
          <EmptyState icon="ti-receipt-off" message={t("receipts.noneYet")} />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {receipts.map((r) => (
            <Card
              key={r.id}
              padding="none"
              className="px-[18px] py-4 cursor-pointer transition-all hover:border-brand"
              onClick={() => setSelectedReceipt(r)}
            >
              <div className="flex justify-between items-start mb-2.5">
                <div className="flex items-center gap-2">
                  <i
                    className="ti ti-receipt text-xl text-muted"
                    aria-hidden="true"
                  />
                  <div>
                    <div className="text-md font-medium text-ink">
                      {r.ai_merchant || t("receipts.unknownMerchant")}
                    </div>
                    <div className="text-[11px] text-muted mt-px">
                      {r.ai_date
                        ? dayjs(r.ai_date).format("MMM D, YYYY")
                        : t("receipts.noDate")}
                    </div>
                  </div>
                </div>
                <Badge tone={STATUS_TONES[r.status] || "neutral"}>
                  {statusLabel(r.status)}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-ink">
                  {r.ai_total ? fmt(r.ai_total) : "—"}
                </div>
                <div className="text-[11px] text-muted">
                  {r.ai_confidence
                    ? t("receipts.confidencePct", {
                        pct: Math.round(r.ai_confidence * 100),
                      })
                    : ""}
                </div>
              </div>
              <div className="text-[11px] text-muted mt-2">
                {r.original_filename} · {dayjs(r.created_at).format("MMM D")}
              </div>
            </Card>
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
