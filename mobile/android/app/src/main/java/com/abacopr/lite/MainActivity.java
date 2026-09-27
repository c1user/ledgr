package com.abacopr.lite;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareIntakePlugin.class);
        super.onCreate(savedInstanceState);
        // Cold start through the share sheet. A restore (savedInstanceState !=
        // null) re-delivers the same launch intent: that share was handled.
        if (savedInstanceState == null) {
            ShareIntakePlugin.receive(this, getIntent(), getBridge());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // launchMode singleTask: a share while the app is alive lands here.
        ShareIntakePlugin.receive(this, intent, getBridge());
    }
}
