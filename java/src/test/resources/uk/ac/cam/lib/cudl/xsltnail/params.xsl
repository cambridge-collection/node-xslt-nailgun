<?xml version="1.0"?>
<xsl:stylesheet version="3.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                xmlns:myparam="http://example.com/myparam"
                exclude-result-prefixes="xs fn myparam">
    <xsl:output method="xml" indent="yes" />
    <xsl:param name="untyped-param"/>
    <xsl:param name="default-param1" select="'default value'"/>
    <xsl:param name="default-param2" select="'default value'"/>
    <xsl:param name="numeric-param" as="xs:integer"/>
    <xsl:param name="date-param" as="xs:date"/>
    <xsl:param name="multi-string-param" as="xs:string*"/>
    <xsl:param name="myparam:namespaced-param" as="xs:string"/>

    <xsl:template match="/">
        <result>
            <param name="untyped-param" value="{$untyped-param}"/>
            <param name="default-param1" value="{$default-param1}"/>
            <param name="default-param2" value="{$default-param2}"/>
            <param name="numeric-param" value="{$numeric-param} * 2 = {$numeric-param * 2}"/>
            <param name="date-param" year="{fn:year-from-date($date-param)}" value="{$date-param}"/>
            <param name="multi-string-param" count="3" value="{string-join($multi-string-param, ', ')}"/>
            <param name="myparam:namespaced-param" value="{$myparam:namespaced-param}"/>
        </result>
    </xsl:template>
</xsl:stylesheet>
