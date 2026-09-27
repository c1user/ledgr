import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button, Card } from "@abaco/ui";
import BrandMark from "@abaco/ui/BrandMark";
import { toast } from "@abaco/ui/feedback";
import api from "../lib/api.js";
import useOutboxStore from "../store/outboxStore.js";
import { captureReceipt, scanStack, releaseCapture } from "../native/camera.js";
import { onSharedFiles } from "../native/shareIntake.js";
import { tap as hapticTap } from "../native/haptics.js";
import UpsellNotice from "../components/UpsellNotice.jsx";
import CaptureSheet from "../components/scan/CaptureSheet.jsx";
import MeterCard from "../components/scan/MeterCard.jsx";
import useScanMeter from "../components/scan/useScanMeter.js";
import OutboxRow from "../components/scan/OutboxRow.jsx";

// Prefix ["receipts"] is shared with the Receipts screen: a successful upload
// invalidates every receipts query, this count included.
const PENDING_COUNT_QUERY_KEY = ["receipts", "pending-count"];

/**
 * Scan home (ROADMAP-V6 2.5 / 2.11): capture → CaptureSheet (upload with
 * progress → Review), the Starter meter, receipts waiting for review and the
 * offline outbox. The OfflineBanner already lives in the Shell header.
 */
export default function Scan() {
  const { t } = useTranslation();
  const { limitReached, used, limit } = useScanMeter();
  const [session, setSession] = useState(null); // { id, mode, captures }
  const [picking, setPicking] = useState(false);

  // Outbox triggers (launch / network back / resume) — idempotent.
  useEffect(() => {
    useOutboxStore.getState().start();
  }, []);

  // Share-sheet intake (2.6): images / PDFs shared from another app arrive as
  // { blob, filename, previewUrl } — the same shape the camera returns — and
  // open the CaptureSheet like a fresh capture. A share that lands while a
  // session is already open replaces it (its captures are released).
  useEffect(
    () =>
      onSharedFiles((files) => {
        if (!files?.length) return;
        setSession((current) => {
          current?.captures.forEach(releaseCapture);
          return {
            id: Date.now(),
            mode: files.length > 1 ? "stack" : "single",
            captures: files,
          };
        });
      }),
    [],
  );

  const pending = useQuery({
    queryKey: PENDING_COUNT_QUERY_KEY,
    queryFn: async () => {
      const { data } = await api.get("/receipts", {
        params: { status: "pending", limit: 50, offset: 0 },
      });
      return Array.isArray(data) ? data.length : 0;
    },
  });

  const endSession = () => {
    setSession((s) => {
      s?.captures.forEach(releaseCapture);
      return null;
    });
  };

  // Opens the scanner / picker and, with at least one capture, the sheet.
  const begin = async (mode, source) => {
    if (picking || session) return;
    setPicking(true);
    hapticTap();
    try {
      let captures;
      if (mode === "stack") {
        captures = await scanStack({ limit: 20 });
      } else {
        const one = await captureReceipt({ source });
        captures = one ? [one] : [];
      }
      if (captures.length > 0) {
        setSession({ id: Date.now(), mode, captures });
      }
    } catch {
      toast.error(t("login.genericError"));
    } finally {
      setPicking(false);
    }
  };

  const scanAnother = () => {
    endSession();
    // Let the sheet unmount before the picker opens.
    setTimeout(() => begin("single", "camera"), 0);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Hero */}
      <Card padding="md" className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <BrandMark size={44} className="shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink leading-tight">
              {t("mobile.scan.title")}
            </h1>
            <p className="text-md text-muted">{t("mobile.scan.subtitle")}</p>
          </div>
        </div>

        {limitReached ? (
          <UpsellNotice feature="ai_receipts" used={used} limit={limit} />
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              full
              icon="ti-scan"
              loading={picking}
              onClick={() => begin("single", "camera")}
            >
              {t("mobile.scan.scanReceipt")}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                size="lg"
                full
                icon="ti-stack-2"
                disabled={picking}
                onClick={() => begin("stack")}
              >
                {t("mobile.scan.scanStack")}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                full
                icon="ti-photo"
                disabled={picking}
                onClick={() => begin("single", "gallery")}
              >
                {t("mobile.scan.chooseFromPhotos")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <MeterCard />

      {pending.data > 0 && (
        <Card padding="none">
          <Link
            to="/receipts?status=pending"
            className="flex min-h-[52px] items-center gap-3 px-3 py-2.5 text-ink"
          >
            <i
              className="ti ti-clock-hour-4 text-brand text-lg shrink-0"
              aria-hidden="true"
            />
            <span className="flex-1 text-md">
              {t("mobile.scan.waitingForReview", { count: pending.data })}
            </span>
            <i
              className="ti ti-chevron-right text-muted shrink-0"
              aria-hidden="true"
            />
          </Link>
        </Card>
      )}

      <OutboxRow />

      {session && (
        <CaptureSheet
          key={session.id}
          session={session}
          onClose={endSession}
          onScanAnother={scanAnother}
        />
      )}
    </div>
  );
}
