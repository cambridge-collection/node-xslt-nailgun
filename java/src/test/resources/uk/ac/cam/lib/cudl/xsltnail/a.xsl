<?xml version="1.0"?>
<xsl:stylesheet version="3.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:param name="thing" select="()"/>
    <xsl:template match="/">
        <result>
            <xsl:if test="count($thing)">
                <xsl:attribute name="thing"><xsl:value-of select="$thing"/></xsl:attribute>
            </xsl:if>
            <xsl:copy-of select="."/>
        </result>
    </xsl:template>
</xsl:stylesheet>
