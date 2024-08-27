package org.jahia.se.modules.contentSharing;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

public class Utils {
    public static Map<String, String> getDecodedParams (String rawQueryString) throws UnsupportedEncodingException {
            // e.g., "c%3D1234%26t%3Dtint%3Acontent"
        Map<String, String> parameters = new HashMap<>();

        if (rawQueryString != null) {
            // Decode the entire query string
            String decodedQueryString = URLDecoder.decode(rawQueryString, "UTF-8");

            // Parse the decoded query string into a map
            parameters = parseQueryString(decodedQueryString);
        }
        return parameters;
    };

    private static Map<String, String> parseQueryString(String queryString) {
        Map<String, String> queryPairs = new HashMap<>();
        String[] pairs = queryString.split("&");
        for (String pair : pairs) {
            int idx = pair.indexOf("=");
            if (idx > 0 && idx < pair.length() - 1) {
                String key = pair.substring(0, idx);
                String value = pair.substring(idx + 1);
                queryPairs.put(key, value);
            }
        }
        return queryPairs;
    }
}
