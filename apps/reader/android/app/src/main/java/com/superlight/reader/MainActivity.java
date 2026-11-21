package com.superlight.reader;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(FileExport.class);
        registerPlugin(NativePicker.class);
        registerPlugin(MetronNative.class);
        super.onCreate(savedInstanceState);
    }
}
