<?xml version="1.0"?>
<xsl:stylesheet version="2.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="/">
        <result base-uri-of-input="{base-uri(.)}">
            <xsl:copy-of select="."/>
        </result>
    </xsl:template>
</xsl:stylesheet>
