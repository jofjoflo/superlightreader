package com.superlight.reader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MetronNativeTest {
    @Test
    public void validatesSearchBoundsAndControls() {
        assertNull(MetronNative.validateSearch("Saga", "1", 1));
        assertTrue(MetronNative.validateSearch("", null, 1) != null);
        assertTrue(MetronNative.validateSearch("Saga\n", null, 1) != null);
        assertTrue(MetronNative.validateSearch("Saga", "", 1) != null);
        assertTrue(MetronNative.validateSearch("Saga", null, 101) != null);
    }

    @Test
    public void acceptsNormalTokenButRejectsMissingOrControlData() {
        assertTrue(MetronNative.isValidToken("  token-value  "));
        assertFalse(MetronNative.isValidToken(null));
        assertFalse(MetronNative.isValidToken("token\nvalue"));
        assertFalse(MetronNative.isValidToken("   "));
    }
}
