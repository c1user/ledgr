import { forwardRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@abaco/ui";
import cx from "@abaco/ui/cx";

/**
 * Password field with a 44px show/hide toggle — phone keyboards make typos
 * likely and there is no second field to compare against. Same controlClass
 * as every other input (16px on phones, no iOS zoom).
 */
const PasswordInput = forwardRef(function PasswordInput(
  { className, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cx("pr-12", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("login.hidePassword") : t("login.showPassword")}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center text-muted transition-colors hover:text-ink"
      >
        <i
          className={cx("ti text-lg", visible ? "ti-eye-off" : "ti-eye")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
});

export default PasswordInput;
