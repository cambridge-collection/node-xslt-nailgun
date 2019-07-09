<?xml version="1.0"?>
<xsl:stylesheet version="3.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="/">
        <number><xsl:value-of select="1 div 0"/></number>
    </xsl:template>
</xsl:stylesheet>
